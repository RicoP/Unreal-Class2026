#include "AssetOriginLabel.h"

bool UAssetOriginLabel::AllowsClass(const UClass* AssetClass) const
{
	if (Whitelist.IsEmpty())
	{
		return true;
	}
	if (!AssetClass)
	{
		return false;
	}
	for (const TSubclassOf<UObject>& Allowed : Whitelist)
	{
		if (Allowed && AssetClass->IsChildOf(Allowed))
		{
			return true;
		}
	}
	return false;
}
