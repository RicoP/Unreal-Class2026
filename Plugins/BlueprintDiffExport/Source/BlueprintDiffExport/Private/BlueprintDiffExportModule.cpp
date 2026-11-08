#include "BlueprintDiffWriter.h"
#include "ContentBrowserMenuContexts.h"
#include "Engine/Blueprint.h"
#include "Engine/World.h"
#include "Framework/Notifications/NotificationManager.h"
#include "HAL/PlatformProcess.h"
#include "Modules/ModuleManager.h"
#include "ToolMenus.h"
#include "Widgets/Notifications/SNotificationList.h"

#define LOCTEXT_NAMESPACE "BlueprintDiffExport"

namespace
{
	void Notify(const FText& Message, bool bSuccess, const FString& OutputPath)
	{
		FNotificationInfo Info(Message);
		Info.ExpireDuration = bSuccess ? 6.0f : 10.0f;
		if (bSuccess)
		{
			Info.Hyperlink = FSimpleDelegate::CreateLambda([OutputPath]()
			{
				FPlatformProcess::ExploreFolder(*OutputPath);
			});
			Info.HyperlinkText = LOCTEXT("ShowFile", "Show in Explorer");
		}
		if (TSharedPtr<SNotificationItem> Item = FSlateNotificationManager::Get().AddNotification(Info))
		{
			Item->SetCompletionState(bSuccess ? SNotificationItem::CS_Success : SNotificationItem::CS_Fail);
		}
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
			bool bExported = false;
			if (Asset->IsA<UWorld>())
			{
				Error = TEXT("Levels aren't supported yet.");
			}
			else if (UBlueprint* Blueprint = Cast<UBlueprint>(Asset))
			{
				bExported = BlueprintDiffExport::ExportDiff(Blueprint, OutputPath, Error);
			}
			else
			{
				bExported = BlueprintDiffExport::ExportAssetDiff(Asset, OutputPath, Error);
			}

			if (bExported)
			{
				Notify(FText::Format(LOCTEXT("Exported", "Wrote diff to {0} and the full version to Doc/graph/reference"), FText::FromString(OutputPath)), true, OutputPath);
			}
			else
			{
				Notify(FText::Format(LOCTEXT("Failed", "Diff for {0} failed: {1}"), FText::FromString(Asset->GetName()), FText::FromString(Error)), false, OutputPath);
			}
		}
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
		UToolMenu* Menu = UToolMenus::Get()->ExtendMenu("ContentBrowser.AssetContextMenu");
		FToolMenuSection& Section = Menu->FindOrAddSection("GetAssetActions");
		Section.AddMenuEntry(
			"ExportBlueprintDiff",
			LOCTEXT("ExportLabel", "Export Diff Against Depot"),
			LOCTEXT("ExportTooltip", "Write the changes since the last revision to Doc/graph/transient/<package path>.sexpr, and the full current version to Doc/graph/reference/<package path>.sexpr. New assets are compared against their class defaults."),
			FSlateIcon(),
			FToolUIAction(FToolMenuExecuteAction::CreateStatic(&ExportSelected)));
	}
};

IMPLEMENT_MODULE(FBlueprintDiffExportModule, BlueprintDiffExport)

#undef LOCTEXT_NAMESPACE
