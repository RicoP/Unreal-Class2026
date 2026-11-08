using UnrealBuildTool;

public class Platforming1Target : TargetRules
{
	public Platforming1Target(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Platforming1");
	}
}
