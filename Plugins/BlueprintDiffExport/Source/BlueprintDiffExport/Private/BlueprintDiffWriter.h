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

	/**
	 * Compares any other asset against its latest revision, or against its class defaults if it
	 * has none, and writes the property changes to <ProjectDir>/Doc/graph/transient/<package path>.sexpr.
	 * Also writes all non-default properties to <ProjectDir>/Doc/graph/reference/<package path>.sexpr.
	 */
	bool ExportAssetDiff(UObject* Asset, FString& OutPath, FString& OutError);
}
