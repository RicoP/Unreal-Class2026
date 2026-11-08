#include "BlueprintDiffWriter.h"
#include "ContentBrowserMenuContexts.h"
#include "Engine/Blueprint.h"
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

		for (UBlueprint* Blueprint : Context->LoadSelectedObjects<UBlueprint>())
		{
			FString OutputPath;
			FString Error;
			if (BlueprintDiffExport::ExportDiff(Blueprint, OutputPath, Error))
			{
				Notify(FText::Format(LOCTEXT("Exported", "Wrote Blueprint diff to {0} and the full graph to Doc/graph/reference"), FText::FromString(OutputPath)), true, OutputPath);
			}
			else
			{
				Notify(FText::Format(LOCTEXT("Failed", "Blueprint diff for {0} failed: {1}"), FText::FromString(Blueprint->GetName()), FText::FromString(Error)), false, OutputPath);
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
		UToolMenu* Menu = UE::ContentBrowser::ExtendToolMenu_AssetContextMenu(UBlueprint::StaticClass());
		FToolMenuSection& Section = Menu->FindOrAddSection("GetAssetActions");
		Section.AddMenuEntry(
			"ExportBlueprintDiff",
			LOCTEXT("ExportLabel", "Export Diff Against Depot"),
			LOCTEXT("ExportTooltip", "Write the variable and node changes since the last revision to Doc/graph/transient/<package path>.sexpr, and the full Blueprint graph to Doc/graph/reference/<package path>.sexpr."),
			FSlateIcon(),
			FToolUIAction(FToolMenuExecuteAction::CreateStatic(&ExportSelected)));
	}
};

IMPLEMENT_MODULE(FBlueprintDiffExportModule, BlueprintDiffExport)

#undef LOCTEXT_NAMESPACE
