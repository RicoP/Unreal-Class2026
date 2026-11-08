#pragma once

#include "CoreMinimal.h"

class UBlueprint;

namespace BlueprintDiffExport
{
	/**
	 * Compares the Blueprint in memory against its latest revision in revision control
	 * and writes the variable and node changes to <ProjectDir>/Doc/graph/transient/<package path>.sexpr.
	 */
	bool ExportDiff(UBlueprint* Blueprint, FString& OutPath, FString& OutError);
}
