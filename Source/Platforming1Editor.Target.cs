using UnrealBuildTool;

public class Platforming1EditorTarget : TargetRules
{
	public Platforming1EditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Platforming1");
	}
}
