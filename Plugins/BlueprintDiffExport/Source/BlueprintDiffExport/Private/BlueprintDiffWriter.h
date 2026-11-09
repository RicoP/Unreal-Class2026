#pragma once

#include "CoreMinimal.h"

class AActor;
class UBlueprint;

namespace BlueprintDiffExport
{
	/**
	 * Compares the Blueprint in memory against its latest revision in revision control
	 * and writes the variable and node changes to <ProjectDir>/Doc/commits/Transient/graph/transient/<package path>.sexpr.
	 */
	bool ExportDiff(UBlueprint* Blueprint, FString& OutPath, FString& OutError);

	/**
	 * Compares any other asset against its latest revision, or against its class defaults if it
	 * has none, and writes the property changes to <ProjectDir>/Doc/commits/Transient/graph/transient/<package path>.sexpr.
	 * Also writes all non-default properties to <ProjectDir>/Doc/commits/Transient/graph/reference/<package path>.sexpr.
	 */
	bool ExportAssetDiff(UObject* Asset, FString& OutPath, FString& OutError);

	/**
	 * For an actor stored in its own file (a level with external actors): compares it against
	 * the latest revision of that file, or against its class defaults if it has none, and writes
	 * <ProjectDir>/Doc/commits/Transient/graph/transient/<level package path>/<actor label>.sexpr, plus the full
	 * version to Doc/commits/Transient/graph/reference/<level package path>/<actor label>.sexpr.
	 */
	bool ExportActorDiff(AActor* Actor, FString& OutPath, FString& OutError);
}
