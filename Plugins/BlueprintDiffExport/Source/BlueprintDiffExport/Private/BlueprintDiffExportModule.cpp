#include "AssetRegistry/AssetRegistryModule.h"
#include "BlueprintDiffWriter.h"
#include "ContentBrowserMenuContexts.h"
#include "Editor.h"
#include "Engine/Blueprint.h"
#include "Engine/World.h"
#include "FileHelpers.h"
#include "Framework/Notifications/NotificationManager.h"
#include "HAL/PlatformProcess.h"
#include "ISourceControlModule.h"
#include "ISourceControlProvider.h"
#include "Misc/MessageDialog.h"
#include "Misc/Paths.h"
#include "Misc/ScopedSlowTask.h"
#include "Modules/ModuleManager.h"
#include "SourceControlHelpers.h"
#include "SourceControlOperations.h"
#include "ToolMenus.h"
#include "Widgets/Notifications/SNotificationList.h"

#define LOCTEXT_NAMESPACE "BlueprintDiffExport"

namespace
{
	void Notify(const FText& Message, bool bSuccess, const FString& PathToShow)
	{
		FNotificationInfo Info(Message);
		Info.ExpireDuration = bSuccess ? 6.0f : 10.0f;
		if (!PathToShow.IsEmpty())
		{
			Info.Hyperlink = FSimpleDelegate::CreateLambda([PathToShow]()
			{
				FPlatformProcess::ExploreFolder(*PathToShow);
			});
			Info.HyperlinkText = LOCTEXT("ShowFile", "Show in Explorer");
		}
		if (TSharedPtr<SNotificationItem> Item = FSlateNotificationManager::Get().AddNotification(Info))
		{
			Item->SetCompletionState(bSuccess ? SNotificationItem::CS_Success : SNotificationItem::CS_Fail);
		}
	}

	/** Export one asset: Blueprints get a graph diff, other assets a property diff. Levels aren't supported. */
	bool ExportAsset(UObject* Asset, FString& OutPath, FString& OutError)
	{
		if (Asset->IsA<UWorld>())
		{
			OutError = TEXT("Levels aren't supported yet.");
			return false;
		}
		if (UBlueprint* Blueprint = Cast<UBlueprint>(Asset))
		{
			return BlueprintDiffExport::ExportDiff(Blueprint, OutPath, OutError);
		}
		return BlueprintDiffExport::ExportAssetDiff(Asset, OutPath, OutError);
	}

	void ExportSelected(const FToolMenuContext& MenuContext)
	{
		const UContentBrowserAssetContextMenuContext* Context =
			UContentBrowserAssetContextMenuContext::FindContextWithAssets(MenuContext);
		if (!Context)
		{
			return;
		}

		for (UObject* Asset : Context->LoadSelectedObjects<UObject>())
		{
			FString OutputPath;
			FString Error;
			if (ExportAsset(Asset, OutputPath, Error))
			{
				Notify(FText::Format(LOCTEXT("Exported", "Wrote diff to {0} and the full version to Doc/graph/reference"), FText::FromString(OutputPath)), true, OutputPath);
			}
			else
			{
				Notify(FText::Format(LOCTEXT("Failed", "Diff for {0} failed: {1}"), FText::FromString(Asset->GetName()), FText::FromString(Error)), false, FString());
			}
		}
	}

	/**
	 * Warn about assets and levels with unsaved changes, which revision control can't see.
	 * Returns false if the user cancels.
	 */
	bool ConfirmUnsavedChanges()
	{
		TArray<UPackage*> Dirty;
		FEditorFileUtils::GetDirtyContentPackages(Dirty);
		FEditorFileUtils::GetDirtyWorldPackages(Dirty);
		if (Dirty.IsEmpty())
		{
			return true;
		}

		TArray<FString> Names;
		for (const UPackage* Package : Dirty)
		{
			Names.AddUnique(Package->GetName());
		}
		Names.Sort();
		constexpr int32 MaxListed = 15;
		FString List = FString::Join(TArrayView<const FString>(Names.GetData(), FMath::Min(Names.Num(), MaxListed)), TEXT("\n"));
		if (Names.Num() > MaxListed)
		{
			List += FString::Printf(TEXT("\n... and %d more"), Names.Num() - MaxListed);
		}

		const FText Message = FText::Format(
			LOCTEXT("UnsavedMessage",
				"{0} asset(s) have unsaved changes:\n\n{1}\n\n"
				"Revision control only sees saved files. Unsaved assets that are unchanged on disk will be left out, "
				"and changed assets are exported with their unsaved state.\n\n"
				"Export anyway? Choose No to cancel and save first."),
			Names.Num(), FText::FromString(List));
		return FMessageDialog::Open(EAppMsgType::YesNo, EAppReturnType::No, Message, LOCTEXT("UnsavedTitle", "Unsaved changes")) == EAppReturnType::Yes;
	}

	/** Export a diff for every project asset that revision control reports as new or modified. */
	void ExportChanged()
	{
		if (GEditor && GEditor->PlayWorld)
		{
			Notify(LOCTEXT("StopPlay", "Stop the Play session before exporting diffs."), false, FString());
			return;
		}
		if (!ConfirmUnsavedChanges())
		{
			return;
		}

		ISourceControlModule& SourceControl = ISourceControlModule::Get();
		if (!SourceControl.IsEnabled() || !SourceControl.GetProvider().IsAvailable())
		{
			Notify(LOCTEXT("NoSourceControl", "Revision control is not enabled or not available."), false, FString());
			return;
		}
		ISourceControlProvider& Provider = SourceControl.GetProvider();

		// All project assets, except the per-actor files of levels.
		TArray<FAssetData> Assets;
		FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry").Get().GetAssetsByPath(FName("/Game"), Assets, true);
		TMap<FString, FAssetData> AssetsByFile;
		for (const FAssetData& Asset : Assets)
		{
			const FString PackageName = Asset.PackageName.ToString();
			if (PackageName.Contains(TEXT("/__External")))
			{
				continue;
			}
			AssetsByFile.Add(FPaths::ConvertRelativePathToFull(SourceControlHelpers::PackageFilename(PackageName)), Asset);
		}

		TArray<FString> Files;
		AssetsByFile.GetKeys(Files);
		Provider.Execute(ISourceControlOperation::Create<FUpdateStatus>(), Files);

		TArray<FAssetData> Changed;
		for (const TPair<FString, FAssetData>& Pair : AssetsByFile)
		{
			const FSourceControlStatePtr State = Provider.GetState(Pair.Key, EStateCacheUsage::Use);
			if (!State.IsValid() || State->IsIgnored() || State->IsDeleted())
			{
				continue;
			}
			// Modified or newly added, or new and not yet known to revision control.
			if (State->IsModified() || State->IsAdded() || !State->IsSourceControlled())
			{
				Changed.Add(Pair.Value);
			}
		}
		Changed.Sort([](const FAssetData& A, const FAssetData& B) { return A.PackageName.LexicalLess(B.PackageName); });

		if (Changed.IsEmpty())
		{
			Notify(LOCTEXT("NothingChanged", "No new or modified assets to export."), true, FString());
			return;
		}

		int32 Exported = 0;
		TArray<FString> Failures;
		{
			FScopedSlowTask Progress(Changed.Num(), LOCTEXT("Exporting", "Exporting diffs of changed assets"));
			Progress.MakeDialog();
			for (const FAssetData& AssetData : Changed)
			{
				Progress.EnterProgressFrame(1, FText::FromName(AssetData.PackageName));
				FString OutputPath;
				FString Error;
				UObject* Asset = AssetData.GetAsset();
				if (!Asset)
				{
					Failures.Add(FString::Printf(TEXT("%s: could not be loaded"), *AssetData.PackageName.ToString()));
				}
				else if (ExportAsset(Asset, OutputPath, Error))
				{
					++Exported;
				}
				else
				{
					Failures.Add(FString::Printf(TEXT("%s: %s"), *AssetData.PackageName.ToString(), *Error));
				}
			}
		}

		for (const FString& Failure : Failures)
		{
			UE_LOG(LogTemp, Warning, TEXT("BlueprintDiffExport: %s"), *Failure);
		}
		const FString TransientFolder = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectDir(), TEXT("Doc/graph/transient")));
		Notify(
			Failures.IsEmpty()
				? FText::Format(LOCTEXT("ExportedChanged", "Exported diffs of {0} changed assets."), Exported)
				: FText::Format(LOCTEXT("ExportedChangedWithFailures", "Exported diffs of {0} changed assets; {1} failed (see the Output Log): {2}"),
					Exported, Failures.Num(), FText::FromString(FString::Join(Failures, TEXT("; ")))),
			Failures.IsEmpty(),
			TransientFolder);
	}
}

class FBlueprintDiffExportModule : public IModuleInterface
{
public:
	virtual void StartupModule() override
	{
		UToolMenus::RegisterStartupCallback(FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FBlueprintDiffExportModule::RegisterMenus));
	}

	virtual void ShutdownModule() override
	{
		UToolMenus::UnRegisterStartupCallback(this);
		UToolMenus::UnregisterOwner(this);
	}

private:
	void RegisterMenus()
	{
		FToolMenuOwnerScoped OwnerScoped(this);

		// Every asset type's context menu inherits from this base menu (there is no ".Object" level),
		// so registering here adds the entry for all assets. Blueprints get a graph diff.
		UToolMenu* AssetMenu = UToolMenus::Get()->ExtendMenu("ContentBrowser.AssetContextMenu");
		FToolMenuSection& AssetSection = AssetMenu->FindOrAddSection("GetAssetActions");
		AssetSection.AddMenuEntry(
			"ExportBlueprintDiff",
			LOCTEXT("ExportLabel", "Export Diff Against Depot"),
			LOCTEXT("ExportTooltip", "Write the changes since the last revision to Doc/graph/transient/<package path>.sexpr, and the full current version to Doc/graph/reference/<package path>.sexpr. New assets are compared against their class defaults."),
			FSlateIcon(),
			FToolUIAction(FToolMenuExecuteAction::CreateStatic(&ExportSelected)));

		UToolMenu* ToolsMenu = UToolMenus::Get()->ExtendMenu("LevelEditor.MainMenu.Tools");
		FToolMenuSection& ToolsSection = ToolsMenu->FindOrAddSection("BlueprintDiffExport", LOCTEXT("ToolsSection", "Documentation"));
		ToolsSection.AddMenuEntry(
			"ExportChangedDiffs",
			LOCTEXT("ExportChangedLabel", "Export Diffs of Changed Assets"),
			LOCTEXT("ExportChangedTooltip", "Export a diff (and full reference) of every project asset that revision control reports as new or modified. Levels are skipped."),
			FSlateIcon(),
			FUIAction(FExecuteAction::CreateStatic(&ExportChanged)));
	}
};

IMPLEMENT_MODULE(FBlueprintDiffExportModule, BlueprintDiffExport)

#undef LOCTEXT_NAMESPACE
