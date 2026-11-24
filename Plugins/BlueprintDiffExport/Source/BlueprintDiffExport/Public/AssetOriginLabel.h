#pragma once

#include "CoreMinimal.h"
#include "Engine/PrimaryAssetLabel.h"
#include "AssetOriginLabel.generated.h"

/**
 * Put one of these into a folder of imported third-party assets (a Fab pack, an itch.io download).
 * The documentation export (Export Diffs of Changed Assets) then doesn't document every new file of
 * that folder and its sub-folders one by one: it lists them in a single "Import <files> from <URL>"
 * step, compacted like an import step ("18 in all: a, b, ..., z").
 *
 * Create it in the Content Browser with Add > Miscellaneous > Data Asset and pick this class.
 */
UCLASS(BlueprintType, Blueprintable)
class BLUEPRINTDIFFEXPORT_API UAssetOriginLabel : public UPrimaryAssetLabel
{
	GENERATED_BODY()

public:
	/** Where all files in this folder and below come from, e.g. the Fab listing or the itch.io page. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Origin")
	FString URL;

	/**
	 * The asset classes the documentation export looks at in this folder. Files of any other class
	 * are left out completely. Empty: nothing is left out.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Origin")
	TArray<TSubclassOf<UObject>> Whitelist;

	/** Whether the export looks at assets of this class: the whitelist is empty or lists it or a parent class. */
	bool AllowsClass(const UClass* AssetClass) const;
};
