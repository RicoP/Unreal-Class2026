#include "BlueprintDiffWriter.h"

#include "DiffResults.h"
#include "DiffUtils.h"
#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphNode.h"
#include "EdGraph/EdGraphPin.h"
#include "EdGraphNode_Comment.h"
#include "EdGraphSchema_K2.h"
#include "Components/ActorComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/Blueprint.h"
#include "Engine/InheritableComponentHandler.h"
#include "Engine/Level.h"
#include "Engine/SCS_Node.h"
#include "Engine/SimpleConstructionScript.h"
#include "EditorFramework/AssetImportData.h"
#include "InterchangeAssetImportData.h"
#include "Misc/PackageName.h"
#include "GameFramework/Actor.h"
#include "GraphDiffControl.h"
#include "ISourceControlModule.h"
#include "ISourceControlProvider.h"
#include "ISourceControlRevision.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "PhysicsEngine/BodySetup.h"
#include "Animation/AnimMontage.h"
#include "Animation/Skeleton.h"
#include "SourceControlHelpers.h"
#include "SourceControlOperations.h"

namespace BlueprintDiffExport
{
namespace
{
	FString Quote(const FString& Text)
	{
		FString Escaped = Text.Replace(TEXT("\\"), TEXT("\\\\")).Replace(TEXT("\""), TEXT("\\\""));
		Escaped.ReplaceInline(TEXT("\r"), TEXT(""));
		Escaped.ReplaceInline(TEXT("\n"), TEXT("\\n"));
		return TEXT("\"") + Escaped + TEXT("\"");
	}

	FString Indent(int32 Depth)
	{
		return FString::ChrN(Depth * 2, TEXT(' '));
	}

	const TCHAR* DiffTypeName(EDiffType::Type Type)
	{
		switch (Type)
		{
		case EDiffType::OBJECT_REMOVED: return TEXT("object-removed");
		case EDiffType::OBJECT_ADDED: return TEXT("object-added");
		case EDiffType::OBJECT_PROPERTY: return TEXT("object-property");
		case EDiffType::NODE_REMOVED: return TEXT("node-removed");
		case EDiffType::NODE_ADDED: return TEXT("node-added");
		case EDiffType::PIN_LINKEDTO_NUM_DEC: return TEXT("pin-links-removed");
		case EDiffType::PIN_LINKEDTO_NUM_INC: return TEXT("pin-links-added");
		case EDiffType::PIN_DEFAULT_VALUE: return TEXT("pin-default-value");
		case EDiffType::PIN_TYPE_CATEGORY: return TEXT("pin-type-category");
		case EDiffType::PIN_TYPE_SUBCATEGORY: return TEXT("pin-type-subcategory");
		case EDiffType::PIN_TYPE_SUBCATEGORY_OBJECT: return TEXT("pin-type-subcategory-object");
		case EDiffType::PIN_TYPE_IS_ARRAY: return TEXT("pin-type-is-array");
		case EDiffType::PIN_TYPE_IS_REF: return TEXT("pin-type-is-ref");
		case EDiffType::PIN_LINKEDTO_NODE: return TEXT("pin-relinked-node");
		case EDiffType::PIN_LINKEDTO_PIN: return TEXT("pin-relinked-pin");
		case EDiffType::NODE_MOVED: return TEXT("node-moved");
		case EDiffType::TIMELINE_LENGTH: return TEXT("timeline-length");
		case EDiffType::TIMELINE_AUTOPLAY: return TEXT("timeline-autoplay");
		case EDiffType::TIMELINE_LOOP: return TEXT("timeline-loop");
		case EDiffType::TIMELINE_IGNOREDILATION: return TEXT("timeline-ignore-dilation");
		case EDiffType::TIMELINE_NUM_TRACKS: return TEXT("timeline-num-tracks");
		case EDiffType::TIMELINE_TRACK_MODIFIED: return TEXT("timeline-track-modified");
		case EDiffType::NODE_PIN_COUNT: return TEXT("node-pin-count");
		case EDiffType::NODE_COMMENT: return TEXT("node-comment");
		case EDiffType::NODE_PROPERTY: return TEXT("node-property");
		case EDiffType::CUSTOM_OBJECT: return TEXT("custom-object");
		default: return TEXT("unknown");
		}
	}

	const TCHAR* CategoryName(EDiffType::Category Category)
	{
		switch (Category)
		{
		case EDiffType::ADDITION: return TEXT("addition");
		case EDiffType::SUBTRACTION: return TEXT("subtraction");
		case EDiffType::MODIFICATION: return TEXT("modification");
		case EDiffType::MINOR: return TEXT("minor");
		default: return TEXT("control");
		}
	}

	FString NodeExpr(const UEdGraphNode* Node)
	{
		if (!Node)
		{
			return TEXT("none");
		}
		return FString::Printf(TEXT("(node %s %s (pos %d %d))"),
			*Quote(Node->GetName()),
			*Quote(Node->GetNodeTitle(ENodeTitleType::ListView).ToString()),
			Node->NodePosX, Node->NodePosY);
	}

	FString PinExpr(const UEdGraphPin* Pin)
	{
		if (!Pin)
		{
			return TEXT("none");
		}
		const UEdGraphNode* Owner = Pin->GetOwningNodeUnchecked();
		return FString::Printf(TEXT("(pin %s %s)"),
			*Quote(Owner ? Owner->GetName() : FString()),
			*Quote(Pin->PinName.ToString()));
	}

	FString LinksExpr(const UEdGraphPin* Pin)
	{
		FString Result = TEXT("(links");
		if (Pin)
		{
			for (const UEdGraphPin* Linked : Pin->LinkedTo)
			{
				Result += TEXT(" ") + PinExpr(Linked);
			}
		}
		return Result + TEXT(")");
	}

	FString PinTypeText(const UEdGraphPin* Pin)
	{
		return UEdGraphSchema_K2::TypeToText(Pin->PinType).ToString();
	}

	/**
	 * Every pin of a node, with its type, default value and links. A comment box also gets
	 * (comment "<text>" (size <width> <height>) (color "#rrggbb")): its position is the node's,
	 * so together they say which nodes it frames.
	 */
	void AddNodeDetails(const UEdGraphNode* Node, int32 Depth, TArray<FString>& Lines)
	{
		if (const UEdGraphNode_Comment* Comment = Cast<UEdGraphNode_Comment>(Node))
		{
			// CommentColor is linear; the editor shows it as sRGB.
			const FColor Color = Comment->CommentColor.ToFColor(true);
			Lines.Add(FString::Printf(TEXT("%s(comment %s (size %d %d) (color \"#%02x%02x%02x\"))"),
				*Indent(Depth), *Quote(Comment->NodeComment), Comment->NodeWidth, Comment->NodeHeight,
				Color.R, Color.G, Color.B));
		}
		for (const UEdGraphPin* Pin : Node->Pins)
		{
			if (!Pin || Pin->bHidden)
			{
				continue;
			}
			FString Line = FString::Printf(TEXT("%s(pin %s %s %s"),
				*Indent(Depth),
				Pin->Direction == EGPD_Input ? TEXT("in") : TEXT("out"),
				*Quote(Pin->PinName.ToString()),
				*Quote(PinTypeText(Pin)));
			if (!Pin->DefaultValue.IsEmpty() && Pin->LinkedTo.IsEmpty())
			{
				Line += TEXT(" (default ") + Quote(Pin->DefaultValue) + TEXT(")");
			}
			if (!Pin->LinkedTo.IsEmpty())
			{
				Line += TEXT(" ") + LinksExpr(Pin);
			}
			Lines.Add(Line + TEXT(")"));
		}
	}

	void AddGraphDiffs(const FString& GraphPath, UEdGraph* OldGraph, UEdGraph* NewGraph, TArray<FString>& Lines)
	{
		TArray<FString> Entries;

		if (OldGraph && NewGraph)
		{
			TArray<FDiffSingleResult> Results;
			FGraphDiffControl::DiffGraphs(OldGraph, NewGraph, Results);
			for (const FDiffSingleResult& Result : Results)
			{
				if (!Result.IsRealDifference())
				{
					continue;
				}

				Entries.Add(FString::Printf(TEXT("%s(%s %s"), *Indent(2), DiffTypeName(Result.Diff), CategoryName(Result.Category)));
				Entries.Add(Indent(3) + TEXT("(text ") + Quote(Result.DisplayString.ToString()) + TEXT(")"));

				if (Result.Diff == EDiffType::NODE_ADDED || Result.Diff == EDiffType::NODE_REMOVED)
				{
					// For added and removed nodes, Node1 is the node itself.
					Entries.Add(Indent(3) + NodeExpr(Result.Node1));
					if (Result.Node1)
					{
						AddNodeDetails(Result.Node1, 3, Entries);
					}
				}
				else
				{
					// Otherwise Node1/Pin1 are the old side and Node2/Pin2 the new side.
					if (Result.Node1 || Result.Node2)
					{
						Entries.Add(Indent(3) + TEXT("(old ") + NodeExpr(Result.Node1) + TEXT(")"));
						Entries.Add(Indent(3) + TEXT("(new ") + NodeExpr(Result.Node2) + TEXT(")"));
					}
					if (Result.Pin1 || Result.Pin2)
					{
						Entries.Add(Indent(3) + TEXT("(old-pin ") + PinExpr(Result.Pin1) + TEXT(" ") + LinksExpr(Result.Pin1)
							+ (Result.Pin1 ? TEXT(" (default ") + Quote(Result.Pin1->DefaultValue) + TEXT(")") : FString()) + TEXT(")"));
						Entries.Add(Indent(3) + TEXT("(new-pin ") + PinExpr(Result.Pin2) + TEXT(" ") + LinksExpr(Result.Pin2)
							+ (Result.Pin2 ? TEXT(" (default ") + Quote(Result.Pin2->DefaultValue) + TEXT(")") : FString()) + TEXT(")"));
					}
				}
				Entries.Last() += TEXT(")");
			}
		}
		else
		{
			UEdGraph* Graph = NewGraph ? NewGraph : OldGraph;
			const TCHAR* NodeType = NewGraph ? TEXT("node-added") : TEXT("node-removed");
			for (const UEdGraphNode* Node : Graph->Nodes)
			{
				if (!Node)
				{
					continue;
				}
				Entries.Add(FString::Printf(TEXT("%s(%s %s"), *Indent(2), NodeType, NewGraph ? TEXT("addition") : TEXT("subtraction")));
				Entries.Add(Indent(3) + NodeExpr(Node));
				AddNodeDetails(Node, 3, Entries);
				Entries.Last() += TEXT(")");
			}
		}

		if (Entries.IsEmpty() && OldGraph && NewGraph)
		{
			return;
		}

		const TCHAR* Status = !OldGraph ? TEXT(" added") : (!NewGraph ? TEXT(" removed") : TEXT(""));
		Lines.Add(FString::Printf(TEXT("%s(graph %s%s"), *Indent(1), *Quote(GraphPath), Status));
		Lines.Append(Entries);
		Lines.Last() += TEXT(")");
	}

	TMap<FGuid, const FBPVariableDescription*> VariablesById(const UBlueprint* Blueprint)
	{
		TMap<FGuid, const FBPVariableDescription*> Result;
		if (Blueprint)
		{
			for (const FBPVariableDescription& Variable : Blueprint->NewVariables)
			{
				Result.Add(Variable.VarGuid, &Variable);
			}
		}
		return Result;
	}

	FString VariableExpr(const FBPVariableDescription& Variable)
	{
		return FString::Printf(TEXT("%s (type %s) (category %s) (default %s) (instance-editable %s)"),
			*Quote(Variable.VarName.ToString()),
			*Quote(UEdGraphSchema_K2::TypeToText(Variable.VarType).ToString()),
			*Quote(Variable.Category.ToString()),
			*Quote(Variable.DefaultValue),
			(Variable.PropertyFlags & CPF_DisableEditOnInstance) ? TEXT("false") : TEXT("true"));
	}

	void AddVariableDiffs(const UBlueprint* OldBlueprint, const UBlueprint* NewBlueprint, TArray<FString>& Lines)
	{
		const TMap<FGuid, const FBPVariableDescription*> OldVariables = VariablesById(OldBlueprint);
		const TMap<FGuid, const FBPVariableDescription*> NewVariables = VariablesById(NewBlueprint);

		TArray<FString> Entries;
		for (const FBPVariableDescription& Variable : NewBlueprint->NewVariables)
		{
			const FBPVariableDescription* const* Old = OldVariables.Find(Variable.VarGuid);
			if (!Old)
			{
				Entries.Add(Indent(2) + TEXT("(added ") + VariableExpr(Variable) + TEXT(")"));
			}
			else if (VariableExpr(**Old) != VariableExpr(Variable))
			{
				Entries.Add(Indent(2) + TEXT("(changed"));
				Entries.Add(Indent(3) + TEXT("(old ") + VariableExpr(**Old) + TEXT(")"));
				Entries.Add(Indent(3) + TEXT("(new ") + VariableExpr(Variable) + TEXT("))"));
			}
		}
		if (OldBlueprint)
		{
			for (const FBPVariableDescription& Variable : OldBlueprint->NewVariables)
			{
				if (!NewVariables.Contains(Variable.VarGuid))
				{
					Entries.Add(Indent(2) + TEXT("(removed ") + VariableExpr(Variable) + TEXT(")"));
				}
			}
		}

		if (!Entries.IsEmpty())
		{
			Lines.Add(Indent(1) + TEXT("(variables"));
			Lines.Append(Entries);
			Lines.Last() += TEXT(")");
		}
	}

	FString PropertyValueText(const FPropertySoftPath& Path, const UObject* Object, const FString& OldPackage, const FString& NewPackage)
	{
		if (!Object)
		{
			return TEXT("none");
		}
		const FResolvedProperty Resolved = Path.Resolve(Object);
		if (!Resolved.Property || !Resolved.Object)
		{
			return TEXT("none");
		}
		FString Value;
		const void* ValuePtr = Resolved.Property->ContainerPtrToValuePtr<void>(const_cast<void*>(Resolved.Object));
		Resolved.Property->ExportTextItem_Direct(Value, ValuePtr, nullptr, const_cast<UObject*>(Object), PPF_None);
		// Object references in the old revision point at its temporary package.
		if (!OldPackage.IsEmpty())
		{
			Value.ReplaceInline(*OldPackage, *NewPackage);
		}
		return Quote(Value);
	}

	/**
	 * Whether a property only points at one of the object's own sub-objects (an actor's or class
	 * default's components, a volume's brush builder). Those aren't set by hand: the editor
	 * creates them with the object, so they are left out of diffs.
	 */
	bool IsOwnSubobjectReference(const FPropertySoftPath& Path, const UObject* Object)
	{
		if (!Object)
		{
			return false;
		}
		const FResolvedProperty Resolved = Path.Resolve(Object);
		const FObjectPropertyBase* Property = CastField<FObjectPropertyBase>(Resolved.Property);
		if (!Property || !Resolved.Object)
		{
			return false;
		}
		const UObject* Value = Property->GetObjectPropertyValue(Property->ContainerPtrToValuePtr<void>(const_cast<void*>(Resolved.Object)));
		return Value && Value->IsIn(Object);
	}

	/**
	 * Property differences between two objects, one line each at the given depth. In a diff each
	 * entry shows the old and new value; in a reference (bReference) only the new value.
	 * bChangedOnly skips properties that only one side has (comparing a Blueprint's class
	 * defaults with its parent's: the extra ones are its variables, listed elsewhere).
	 */
	TArray<FString> PropertyEntries(const UObject* Old, const UObject* New, bool bReference, bool bChangedOnly, int32 Depth,
		const FString& OldPackage, const FString& NewPackage)
	{
		TArray<FString> Entries;
		if (!Old || !New)
		{
			return Entries;
		}
		TArray<FSingleObjectDiffEntry> Differences;
		DiffUtils::CompareUnrelatedObjects(Old, New, Differences);
		for (const FSingleObjectDiffEntry& Difference : Differences)
		{
			if (bChangedOnly && Difference.DiffType != EPropertyDiffType::PropertyValueChanged)
			{
				continue;
			}
			if (IsOwnSubobjectReference(Difference.Identifier, Old) || IsOwnSubobjectReference(Difference.Identifier, New))
			{
				continue;
			}
			const FString Name = Quote(Difference.Identifier.ToDisplayName());
			const FString NewValue = PropertyValueText(Difference.Identifier, New, OldPackage, NewPackage);
			if (bReference)
			{
				Entries.Add(FString::Printf(TEXT("%s(set %s %s)"), *Indent(Depth), *Name, *NewValue));
				continue;
			}
			const TCHAR* Kind =
				Difference.DiffType == EPropertyDiffType::PropertyAddedToA ? TEXT("removed") :
				Difference.DiffType == EPropertyDiffType::PropertyAddedToB ? TEXT("added") : TEXT("changed");
			Entries.Add(FString::Printf(TEXT("%s(%s %s (old %s) (new %s))"), *Indent(Depth), Kind, *Name,
				*PropertyValueText(Difference.Identifier, Old, OldPackage, NewPackage), *NewValue));
		}
		return Entries;
	}

	/** An asset's import data (source file, and for Interchange imports the import options), or null. */
	const UAssetImportData* ImportDataOf(const UObject* Asset)
	{
		const FObjectPropertyBase* Property = Asset ? FindFProperty<FObjectPropertyBase>(Asset->GetClass(), TEXT("AssetImportData")) : nullptr;
		return Property ? Cast<UAssetImportData>(Property->GetObjectPropertyValue_InContainer(Asset)) : nullptr;
	}

	/**
	 * Options of an import pipeline that differ from the pipeline class defaults, as
	 * (set "<sub-object path> <property>" value) lines. Sub-objects (an Interchange pipeline's
	 * mesh, animation and common skeletal mesh settings) are walked recursively.
	 */
	void AddOptionEntries(const UObject* Object, const UObject* Defaults, const FString& Prefix, int32 Depth, TArray<FString>& Lines, int32 Level = 0)
	{
		if (!Object || Level > 4)
		{
			return;
		}
		if (!Defaults || Defaults->GetClass() != Object->GetClass())
		{
			Defaults = Object->GetClass()->GetDefaultObject();
		}
		TArray<FSingleObjectDiffEntry> Differences;
		DiffUtils::CompareUnrelatedObjects(Defaults, Object, Differences);
		for (const FSingleObjectDiffEntry& Difference : Differences)
		{
			if (Difference.DiffType != EPropertyDiffType::PropertyValueChanged || IsOwnSubobjectReference(Difference.Identifier, Object))
			{
				continue;
			}
			Lines.Add(FString::Printf(TEXT("%s(set %s %s)"), *Indent(Depth),
				*Quote(Prefix + Difference.Identifier.ToDisplayName()),
				*PropertyValueText(Difference.Identifier, Object, FString(), FString())));
		}
		for (TFieldIterator<FObjectPropertyBase> Property(Object->GetClass()); Property; ++Property)
		{
			const UObject* Subobject = Property->GetObjectPropertyValue_InContainer(Object);
			if (Subobject && Subobject->IsIn(Object))
			{
				AddOptionEntries(Subobject, Property->GetObjectPropertyValue_InContainer(Defaults),
					Prefix + Property->GetName() + TEXT(" "), Depth, Lines, Level + 1);
			}
		}
	}

	/**
	 * Where an imported asset came from: (imported-from "<source file>"), and for assets imported
	 * with Interchange (import-options (set ...) ...) with the import dialog's settings that
	 * differ from the pipeline defaults, such as the Skeleton to use or whether to import
	 * animations. Nothing for assets that weren't imported.
	 */
	void AddImportInfo(const UObject* Asset, TArray<FString>& Lines)
	{
		const UAssetImportData* ImportData = ImportDataOf(Asset);
		const FString Source = ImportData ? ImportData->GetFirstFilename() : FString();
		if (Source.IsEmpty())
		{
			return;
		}
		Lines.Add(Indent(1) + TEXT("(imported-from ") + Quote(FPaths::ConvertRelativePathToFull(Source)) + TEXT(")"));
		if (const UInterchangeAssetImportData* Interchange = Cast<UInterchangeAssetImportData>(ImportData))
		{
			TArray<FString> Options;
			for (const UObject* Pipeline : Interchange->GetPipelines())
			{
				if (Pipeline)
				{
					AddOptionEntries(Pipeline, nullptr, FString(), 2, Options);
				}
			}
			if (!Options.IsEmpty())
			{
				Lines.Add(Indent(1) + TEXT("(import-options"));
				Lines.Append(Options);
				Lines.Last() += TEXT(")");
			}
		}
	}

	/**
	 * The package name to replace in values of an older revision: the temporary package it was
	 * loaded into for diffing, so its references read like the real asset's. "" otherwise (for
	 * example when comparing against class defaults).
	 */
	FString OldPackageOf(const UObject* Old, const UObject* New)
	{
		if (!Old || !New || Old->GetPackage() == New->GetPackage())
		{
			return FString();
		}
		const FString Name = Old->GetPackage()->GetName();
		return FPackageName::IsTempPackage(Name) ? Name : FString();
	}

	/**
	 * Class defaults (Class Defaults panel) that differ from the previous revision, or for a new
	 * Blueprint (OldBlueprint null) from the parent class: (defaults ...). In a reference
	 * (bReference), everything that differs from the parent class.
	 */
	void AddDefaultsDiffs(const UBlueprint* OldBlueprint, const UBlueprint* NewBlueprint, bool bReference, TArray<FString>& Lines)
	{
		const UObject* NewDefaults = DiffUtils::GetCDO(NewBlueprint);
		const UObject* OldDefaults = OldBlueprint ? DiffUtils::GetCDO(OldBlueprint)
			: NewBlueprint->ParentClass ? NewBlueprint->ParentClass->GetDefaultObject() : nullptr;
		if (!OldDefaults || !NewDefaults)
		{
			return;
		}
		const FString OldPackage = OldBlueprint ? OldBlueprint->GetPackage()->GetName() : FString();
		const FString NewPackage = NewBlueprint->GetPackage()->GetName();
		const TArray<FString> Entries = PropertyEntries(OldDefaults, NewDefaults, bReference, !OldBlueprint, 2, OldPackage, NewPackage);
		if (!Entries.IsEmpty())
		{
			Lines.Add(Indent(1) + (OldBlueprint ? TEXT("(defaults") : TEXT("(defaults (baseline parent-class)")));
			Lines.Append(Entries);
			Lines.Last() += TEXT(")");
		}
	}

	/** A component of a Blueprint, as the Components panel shows it. */
	struct FComponentEntry
	{
		const UActorComponent* Template = nullptr;
		/** native (from the C++ parent, e.g. a Character's Mesh), added (in this Blueprint), inherited (from a parent Blueprint). */
		const TCHAR* Kind = TEXT("native");
		FString AttachTo;
		/** The component as it would be without this Blueprint's changes. */
		const UActorComponent* Original = nullptr;
	};

	TMap<FString, FComponentEntry> ComponentsOf(const UBlueprint* Blueprint)
	{
		TMap<FString, FComponentEntry> Result;
		if (!Blueprint)
		{
			return Result;
		}
		const UObject* ParentDefaults = Blueprint->ParentClass ? Blueprint->ParentClass->GetDefaultObject() : nullptr;

		// Components of the C++ parent class: sub-objects of the class defaults.
		if (UObject* Defaults = const_cast<UObject*>(DiffUtils::GetCDO(Blueprint)))
		{
			TArray<UObject*> Subobjects;
			Defaults->GetDefaultSubobjects(Subobjects);
			for (const UObject* Subobject : Subobjects)
			{
				if (const UActorComponent* Component = Cast<UActorComponent>(Subobject))
				{
					FComponentEntry Entry;
					Entry.Template = Component;
					Entry.Original = ParentDefaults
						? Cast<UActorComponent>(const_cast<UObject*>(ParentDefaults)->GetDefaultSubobjectByName(Component->GetFName()))
						: nullptr;
					// The Components panel names it after the property that holds it (a Character's
					// "Mesh"), not after its object name ("CharacterMesh0").
					FString PanelName = Component->GetName();
					for (TFieldIterator<FObjectPropertyBase> Property(Defaults->GetClass()); Property; ++Property)
					{
						if (Property->GetObjectPropertyValue_InContainer(Defaults) == Component)
						{
							PanelName = Property->GetName();
							break;
						}
					}
					Result.Add(PanelName, Entry);
				}
			}
		}

		// Components added in this Blueprint's Components panel.
		if (const USimpleConstructionScript* Construction = Blueprint->SimpleConstructionScript)
		{
			for (USCS_Node* Node : Construction->GetAllNodes())
			{
				if (!Node || !Node->ComponentTemplate)
				{
					continue;
				}
				FComponentEntry Entry;
				Entry.Template = Node->ComponentTemplate;
				Entry.Kind = TEXT("added");
				Entry.Original = Node->ComponentTemplate->GetClass()->GetDefaultObject<UActorComponent>();
				if (const USCS_Node* Parent = Construction->FindParentNode(Node))
				{
					Entry.AttachTo = Parent->GetVariableName().ToString();
				}
				else if (Node->ParentComponentOrVariableName != NAME_None)
				{
					Entry.AttachTo = Node->ParentComponentOrVariableName.ToString();
				}
				Result.Add(Node->GetVariableName().ToString(), Entry);
			}
		}

		// Components of a parent Blueprint that this Blueprint changes.
		if (UInheritableComponentHandler* Handler = const_cast<UBlueprint*>(Blueprint)->InheritableComponentHandler)
		{
			for (auto Record = Handler->CreateRecordIterator(); Record; ++Record)
			{
				if (!Record->ComponentTemplate)
				{
					continue;
				}
				FComponentEntry Entry;
				Entry.Template = Record->ComponentTemplate;
				Entry.Kind = TEXT("inherited");
				Entry.Original = Record->ComponentKey.GetOriginalTemplate();
				Result.Add(Record->ComponentKey.GetSCSVariableName().ToString(), Entry);
			}
		}
		return Result;
	}

	/**
	 * Components that were added, removed or changed since the previous revision, or for a new
	 * Blueprint (OldBlueprint null) those it adds or changes compared to its parent:
	 * (components (component "Mesh" (class ...) (kind native) (properties (changed ...))) ...).
	 * In a reference (bReference), every component with its non-default properties.
	 */
	void AddComponentDiffs(const UBlueprint* OldBlueprint, const UBlueprint* NewBlueprint, bool bReference, TArray<FString>& Lines)
	{
		const TMap<FString, FComponentEntry> NewComponents = ComponentsOf(NewBlueprint);
		const TMap<FString, FComponentEntry> OldComponents = ComponentsOf(OldBlueprint);
		const FString NewPackage = NewBlueprint->GetPackage()->GetName();

		TArray<FString> Names;
		NewComponents.GetKeys(Names);
		Names.Sort();

		TArray<FString> Entries;
		for (const FString& Name : Names)
		{
			const FComponentEntry& Entry = NewComponents[Name];
			const FComponentEntry* OldEntry = OldBlueprint ? OldComponents.Find(Name) : nullptr;
			// A component is new if this Blueprint adds it (and it wasn't there before).
			const bool bNew = FCString::Strcmp(Entry.Kind, TEXT("added")) == 0 && !OldEntry;
			const UActorComponent* Baseline = OldEntry ? OldEntry->Template : Entry.Original;
			if (!Baseline)
			{
				Baseline = Entry.Template->GetClass()->GetDefaultObject<UActorComponent>();
			}
			const TArray<FString> Properties = PropertyEntries(Baseline, Entry.Template, bReference, false, 4,
				OldPackageOf(Baseline, Entry.Template), NewPackage);
			if (!bNew && Properties.IsEmpty())
			{
				continue;
			}
			FString Header = FString::Printf(TEXT("%s(component %s (class %s) (kind %s)"),
				*Indent(2), *Quote(Name), *Quote(Entry.Template->GetClass()->GetName()), Entry.Kind);
			if (!Entry.AttachTo.IsEmpty())
			{
				Header += TEXT(" (attach-to ") + Quote(Entry.AttachTo) + TEXT(")");
			}
			if (bNew && !bReference)
			{
				Header += TEXT(" (new)");
			}
			Entries.Add(Header);
			Entries.Add(Indent(3) + TEXT("(properties"));
			Entries.Append(Properties);
			Entries.Last() += TEXT("))");
		}
		if (OldBlueprint && !bReference)
		{
			TArray<FString> OldNames;
			OldComponents.GetKeys(OldNames);
			OldNames.Sort();
			for (const FString& Name : OldNames)
			{
				// Only components this Blueprint added can be removed in it. An inherited one that is
				// gone only lost this Blueprint's overrides: they were reset, or the parent Blueprint
				// removed the component (its own diff shows that).
				if (!NewComponents.Contains(Name) && FCString::Strcmp(OldComponents[Name].Kind, TEXT("added")) == 0)
				{
					Entries.Add(Indent(2) + TEXT("(component-removed ") + Quote(Name) + TEXT(")"));
				}
			}
		}
		if (!Entries.IsEmpty())
		{
			Lines.Add(Indent(1) + TEXT("(components"));
			Lines.Append(Entries);
			Lines.Last() += TEXT(")");
		}
	}

	TMap<FString, UEdGraph*> GraphsByPath(const UBlueprint* Blueprint)
	{
		TMap<FString, UEdGraph*> Result;
		if (Blueprint)
		{
			TArray<UEdGraph*> Graphs;
			Blueprint->GetAllGraphs(Graphs);
			for (UEdGraph* Graph : Graphs)
			{
				if (Graph)
				{
					Result.Add(Graph->GetPathName(Blueprint), Graph);
				}
			}
		}
		return Result;
	}

	/** "/Game/Folder/BP_Name" -> <ProjectDir>/<Folder>/Game/Folder/BP_Name.sexpr */
	FString OutputPathFor(const FString& PackageName, const TCHAR* Folder)
	{
		return FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectDir(), Folder, PackageName.RightChop(1) + TEXT(".sexpr")));
	}

	bool WriteLines(const TArray<FString>& Lines, const FString& Path, FString& OutError)
	{
		const FString Text = FString::Join(Lines, TEXT("\n")) + TEXT("\n");
		if (!FFileHelper::SaveStringToFile(Text, *Path, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
		{
			OutError = FString::Printf(TEXT("Could not write %s"), *Path);
			return false;
		}
		return true;
	}

	/** Every node of a graph with all its visible pins, sorted by node name. */
	void AddFullGraph(const FString& GraphPath, const UEdGraph* Graph, TArray<FString>& Lines)
	{
		Lines.Add(Indent(1) + TEXT("(graph ") + Quote(GraphPath));

		TArray<const UEdGraphNode*> Nodes;
		for (const UEdGraphNode* Node : Graph->Nodes)
		{
			if (Node)
			{
				Nodes.Add(Node);
			}
		}
		Nodes.Sort([](const UEdGraphNode& A, const UEdGraphNode& B) { return A.GetName() < B.GetName(); });

		for (const UEdGraphNode* Node : Nodes)
		{
			Lines.Add(Indent(2) + NodeExpr(Node).LeftChop(1));
			AddNodeDetails(Node, 3, Lines);
			Lines.Last() += TEXT(")");
		}
		Lines.Last() += TEXT(")");
	}

	/** The whole Blueprint as it is in the editor: variables and every graph. */
	TArray<FString> ReferenceLines(const UBlueprint* Blueprint)
	{
		TArray<FString> Lines;
		Lines.Add(TEXT("(blueprint ") + Quote(Blueprint->GetOutermost()->GetName()));
		Lines.Add(Indent(1) + TEXT("(revision working-copy)"));
		Lines.Add(Indent(1) + TEXT("(parent ") + Quote(Blueprint->ParentClass ? Blueprint->ParentClass->GetPathName() : FString()) + TEXT(")"));

		Lines.Add(Indent(1) + TEXT("(variables"));
		for (const FBPVariableDescription& Variable : Blueprint->NewVariables)
		{
			Lines.Add(Indent(2) + TEXT("(variable ") + VariableExpr(Variable) + TEXT(")"));
		}
		Lines.Last() += TEXT(")");

		// Class defaults and components that differ from the parent class.
		AddDefaultsDiffs(nullptr, Blueprint, true, Lines);
		AddComponentDiffs(nullptr, Blueprint, true, Lines);

		const TMap<FString, UEdGraph*> Graphs = GraphsByPath(Blueprint);
		TArray<FString> Paths;
		Graphs.GetKeys(Paths);
		Paths.Sort();
		for (const FString& Path : Paths)
		{
			AddFullGraph(Path, Graphs[Path], Lines);
		}
		Lines.Last() += TEXT(")");
		return Lines;
	}

	/** Loads the latest revision of an asset from revision control, or returns null if there is none. */
	UObject* LoadDepotRevision(const UObject* Blueprint, FString& OutRevisionLine, FString& OutError)
	{
		ISourceControlModule& SourceControl = ISourceControlModule::Get();
		if (!SourceControl.IsEnabled() || !SourceControl.GetProvider().IsAvailable())
		{
			OutError = TEXT("Revision control is not enabled or not available.");
			return nullptr;
		}

		ISourceControlProvider& Provider = SourceControl.GetProvider();
		// GetPackage, not GetOutermost: an external actor's file is its own package, not the level's.
		const FString PackageName = Blueprint->GetPackage()->GetName();
		const FString Filename = SourceControlHelpers::PackageFilename(PackageName);

		TSharedRef<FUpdateStatus, ESPMode::ThreadSafe> UpdateStatus = ISourceControlOperation::Create<FUpdateStatus>();
		UpdateStatus->SetUpdateHistory(true);
		Provider.Execute(UpdateStatus, Filename);

		const FSourceControlStatePtr State = Provider.GetState(Filename, EStateCacheUsage::Use);
		if (!State.IsValid() || !State->IsSourceControlled() || State->GetHistorySize() == 0)
		{
			OutRevisionLine = TEXT("(old none)");
			return nullptr;
		}

		const TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> Revision = State->GetHistoryItem(0);

		// If the latest revision deleted the file, the asset was re-created since: treat it as new.
		if (Revision.IsValid() && Revision->GetAction() == TEXT("delete"))
		{
			OutRevisionLine = FString::Printf(TEXT("(old none (deleted-in %s))"), *Quote(Revision->GetRevision()));
			return nullptr;
		}

		UPackage* TempPackage = Revision.IsValid() ? DiffUtils::LoadPackageForDiff(Revision) : nullptr;
		if (!TempPackage)
		{
			OutError = TEXT("Could not load the revision from revision control.");
			return nullptr;
		}

		UObject* OldObject = FindObject<UObject>(TempPackage, *Blueprint->GetName());
		if (!OldObject)
		{
			OldObject = TempPackage->FindAssetInPackage();
		}

		OutRevisionLine = FString::Printf(TEXT("(old (revision %s) (date %s) (description %s))"),
			*Quote(Revision->GetRevision()),
			*Quote(Revision->GetDate().ToIso8601()),
			*Quote(Revision->GetDescription().TrimStartAndEnd()));
		return OldObject;
	}

	/** An asset's physics body setup (a static mesh's collision), or null if it has none. */
	const UBodySetup* BodySetupOf(const UObject* Asset)
	{
		const FObjectPropertyBase* Property = Asset ? FindFProperty<FObjectPropertyBase>(Asset->GetClass(), TEXT("BodySetup")) : nullptr;
		return Property ? Cast<UBodySetup>(Property->GetObjectPropertyValue_InContainer(Asset)) : nullptr;
	}

	/**
	 * A body setup's simple collision shapes, counted per kind as the Static Mesh Editor's
	 * Collision > Primitives lists them ("1 Box, 2 Convex Elements"), or "no simple collision".
	 */
	FString CollisionPrimitivesText(const UBodySetup* BodySetup)
	{
		TArray<FString> Parts;
		if (BodySetup)
		{
			const FKAggregateGeom& Geometry = BodySetup->AggGeom;
			const auto Count = [&Parts](int32 Number, const TCHAR* One, const TCHAR* Many)
			{
				if (Number > 0)
				{
					Parts.Add(FString::Printf(TEXT("%d %s"), Number, Number == 1 ? One : Many));
				}
			};
			Count(Geometry.BoxElems.Num(), TEXT("Box"), TEXT("Boxes"));
			Count(Geometry.SphereElems.Num(), TEXT("Sphere"), TEXT("Spheres"));
			Count(Geometry.SphylElems.Num(), TEXT("Capsule"), TEXT("Capsules"));
			Count(Geometry.ConvexElems.Num(), TEXT("Convex Element"), TEXT("Convex Elements"));
			Count(Geometry.TaperedCapsuleElems.Num(), TEXT("Tapered Capsule"), TEXT("Tapered Capsules"));
			Count(Geometry.LevelSetElems.Num(), TEXT("Level Set"), TEXT("Level Sets"));
		}
		return Quote(Parts.IsEmpty() ? FString(TEXT("no simple collision")) : FString::Join(Parts, TEXT(", ")));
	}

	/** A body setup's Collision Complexity as the editor names it ("Project Default"), or "none". */
	FString CollisionComplexityText(const UBodySetup* BodySetup)
	{
		const FByteProperty* Property = BodySetup ? FindFProperty<FByteProperty>(UBodySetup::StaticClass(), TEXT("CollisionTraceFlag")) : nullptr;
		if (!Property || !Property->Enum)
		{
			return Quote(TEXT("none"));
		}
		const uint8 Value = Property->GetPropertyValue_InContainer(BodySetup);
		return Quote(Property->Enum->GetDisplayNameTextByValue(Value).ToString());
	}

	/**
	 * A static mesh's collision. It lives in the mesh's BodySetup sub-object, which PropertyEntries
	 * leaves out like every reference to an object's own sub-objects, so removing or adding
	 * collision in the Static Mesh Editor would not show. Only what is set by hand is listed: the
	 * simple collision shapes per kind and the Collision Complexity, not the body setup's internal
	 * data (its GUID changes whenever collision is rebuilt).
	 */
	void AddBodySetupEntries(const UObject* Old, const UObject* New, bool bReference, int32 Depth, TArray<FString>& Lines)
	{
		const UBodySetup* NewSetup = BodySetupOf(New);
		const UBodySetup* OldSetup = BodySetupOf(Old);
		if (!NewSetup && !OldSetup)
		{
			return;
		}
		const auto Add = [&](const TCHAR* Name, const FString& OldValue, const FString& NewValue)
		{
			if (OldValue == NewValue)
			{
				return;
			}
			Lines.Add(bReference
				? FString::Printf(TEXT("%s(set %s %s)"), *Indent(Depth), *Quote(Name), *NewValue)
				: FString::Printf(TEXT("%s(changed %s (old %s) (new %s))"), *Indent(Depth), *Quote(Name), *OldValue, *NewValue));
		};
		// A mesh compared with its class default has no body setup there: compare with an empty one.
		const UBodySetup* Baseline = OldSetup ? OldSetup : GetDefault<UBodySetup>();
		Add(TEXT("BodySetup CollisionPrimitives"), CollisionPrimitivesText(OldSetup), CollisionPrimitivesText(NewSetup));
		Add(TEXT("BodySetup CollisionComplexity"), CollisionComplexityText(Baseline), CollisionComplexityText(NewSetup));
	}

	/**
	 * A montage's slots and what plays in them, as the Montage editor's slot tracks show it:
	 * "DefaultGroup.DefaultSlot: MM_Attack_01" (several slots separated by "; "), or "none".
	 */
	FString MontageSlotsText(const UObject* Object)
	{
		const UAnimMontage* Montage = Cast<UAnimMontage>(Object);
		if (!Montage)
		{
			return Quote(TEXT("none"));
		}
		const USkeleton* Skeleton = Montage->GetSkeleton();
		TArray<FString> Slots;
		for (const FSlotAnimationTrack& Track : Montage->SlotAnimTracks)
		{
			TArray<FString> Animations;
			for (const FAnimSegment& Segment : Track.AnimTrack.AnimSegments)
			{
				if (const UAnimSequenceBase* Animation = Segment.GetAnimReference())
				{
					Animations.Add(Animation->GetName());
				}
			}
			const FName Group = Skeleton ? Skeleton->GetSlotGroupName(Track.SlotName) : NAME_None;
			const FString Slot = Group.IsNone() ? Track.SlotName.ToString() : Group.ToString() + TEXT(".") + Track.SlotName.ToString();
			Slots.Add(Slot + TEXT(": ") + (Animations.IsEmpty() ? FString(TEXT("no animation")) : FString::Join(Animations, TEXT(", "))));
		}
		return Quote(Slots.IsEmpty() ? FString(TEXT("none")) : FString::Join(Slots, TEXT("; ")));
	}

	/**
	 * A montage's slot tracks. They aren't editable properties (the Montage editor edits them
	 * with its own UI), so PropertyEntries doesn't see them, and without them a montage's
	 * table wouldn't say which animation it plays.
	 */
	void AddMontageEntries(const UObject* Old, const UObject* New, bool bReference, int32 Depth, TArray<FString>& Lines)
	{
		if (!Cast<UAnimMontage>(New) && !Cast<UAnimMontage>(Old))
		{
			return;
		}
		const FString OldValue = MontageSlotsText(Old), NewValue = MontageSlotsText(New);
		if (OldValue != NewValue)
		{
			Lines.Add(bReference
				? FString::Printf(TEXT("%s(set \"MontageSlots\" %s)"), *Indent(Depth), *NewValue)
				: FString::Printf(TEXT("%s(changed \"MontageSlots\" (old %s) (new %s))"), *Indent(Depth), *OldValue, *NewValue));
		}
	}

	/**
	 * Property differences between two objects of the same kind. In a diff each entry shows
	 * the old and new value; in a reference (compared against the class default) only the value.
	 * An asset's collision (BodySetup) is included.
	 */
	void AddPropertyDiffs(const UObject* Old, const UObject* New, bool bReference, TArray<FString>& Lines)
	{
		Lines.Add(Indent(1) + TEXT("(properties"));
		Lines.Append(PropertyEntries(Old, New, bReference, false, 2, OldPackageOf(Old, New), New->GetPackage()->GetName()));
		AddBodySetupEntries(Old, New, bReference, 2, Lines);
		AddMontageEntries(Old, New, bReference, 2, Lines);
		Lines.Last() += TEXT(")");
	}
}

bool ExportAssetDiff(UObject* Asset, FString& OutPath, FString& OutError)
{
	if (!Asset)
	{
		OutError = TEXT("No asset selected.");
		return false;
	}

	const FString PackageName = Asset->GetOutermost()->GetName();
	const UObject* ClassDefault = Asset->GetClass()->GetDefaultObject();
	OutPath = OutputPathFor(PackageName, TEXT("Doc/commits/Transient/graph/transient"));

	FString RevisionLine;
	const UObject* Old = LoadDepotRevision(Asset, RevisionLine, OutError);
	if (!OutError.IsEmpty())
	{
		return false;
	}

	// A new asset is compared against the defaults of its class, so the diff lists what was set.
	TArray<FString> Lines;
	Lines.Add(TEXT("(asset-diff ") + Quote(PackageName));
	Lines.Add(Indent(1) + TEXT("(class ") + Quote(Asset->GetClass()->GetName()) + TEXT(")"));
	Lines.Add(Indent(1) + RevisionLine);
	if (!Old)
	{
		Lines.Add(Indent(1) + TEXT("(baseline class-default)"));
	}
	Lines.Add(Indent(1) + TEXT("(new working-copy)"));
	AddImportInfo(Asset, Lines);
	AddPropertyDiffs(Old ? Old : ClassDefault, Asset, false, Lines);
	Lines.Last() += TEXT(")");

	TArray<FString> Reference;
	Reference.Add(TEXT("(asset ") + Quote(PackageName));
	Reference.Add(Indent(1) + TEXT("(class ") + Quote(Asset->GetClass()->GetName()) + TEXT(")"));
	Reference.Add(Indent(1) + TEXT("(revision working-copy)"));
	AddPropertyDiffs(ClassDefault, Asset, true, Reference);
	Reference.Last() += TEXT(")");

	return WriteLines(Lines, OutPath, OutError)
		&& WriteLines(Reference, OutputPathFor(PackageName, TEXT("Doc/commits/Transient/graph/reference")), OutError);
}

namespace
{
	FString NumberText(double Value)
	{
		return FString::SanitizeFloat(FMath::RoundToDouble(Value * 1000.0) / 1000.0);
	}

	FString VectorText(const FVector& Vector)
	{
		return NumberText(Vector.X) + TEXT(" ") + NumberText(Vector.Y) + TEXT(" ") + NumberText(Vector.Z);
	}

	/**
	 * Where the actor is placed: its root component's relative transform (the world transform
	 * unless the actor is attached). Relative values also work for a revision loaded for diffing,
	 * whose components are never registered.
	 */
	FString TransformExpr(const TCHAR* Name, const AActor* Actor)
	{
		const USceneComponent* Root = Actor ? Actor->GetRootComponent() : nullptr;
		if (!Root)
		{
			return FString::Printf(TEXT("(%s none)"), Name);
		}
		const FRotator Rotation = Root->GetRelativeRotation();
		return FString::Printf(TEXT("(%s (location %s) (rotation %s %s %s) (scale %s))"), Name,
			*VectorText(Root->GetRelativeLocation()),
			*NumberText(Rotation.Pitch), *NumberText(Rotation.Yaw), *NumberText(Rotation.Roll),
			*VectorText(Root->GetRelativeScale3D()));
	}
}

bool ExportActorDiff(AActor* Actor, FString& OutPath, FString& OutError)
{
	if (!Actor)
	{
		OutError = TEXT("No actor selected.");
		return false;
	}
	if (!Actor->IsPackageExternal())
	{
		OutError = TEXT("This actor isn't stored in its own file (its level doesn't use external actors).");
		return false;
	}

	// Files are named after the level and the actor's label, not the hashed actor file name:
	// Doc/commits/Transient/graph/transient/Game/ThirdPerson/Lvl_ThirdPerson/BP_Enemy_Variant1.sexpr
	const ULevel* Level = Actor->GetLevel();
	const FString LevelPackage = Level ? Level->GetOutermost()->GetName() : Actor->GetOutermost()->GetName();
	const FString Label = Actor->GetActorLabel();
	const FString FileName = LevelPackage + TEXT("/") + FPaths::MakeValidFileName(Label, TEXT('_'));
	OutPath = OutputPathFor(FileName, TEXT("Doc/commits/Transient/graph/transient"));

	FString RevisionLine;
	const UObject* OldObject = LoadDepotRevision(Actor, RevisionLine, OutError);
	if (!OutError.IsEmpty())
	{
		return false;
	}
	const AActor* Old = Cast<AActor>(OldObject);
	if (OldObject && !Old)
	{
		OutError = TEXT("The committed revision of this actor's file holds no actor.");
		return false;
	}
	const UObject* ClassDefault = Actor->GetClass()->GetDefaultObject();

	const auto AddHeader = [&](const TCHAR* Kind, TArray<FString>& Lines)
	{
		Lines.Add(FString::Printf(TEXT("(%s %s"), Kind, *Quote(LevelPackage)));
		Lines.Add(Indent(1) + TEXT("(label ") + Quote(Label) + TEXT(")"));
		Lines.Add(Indent(1) + TEXT("(class ") + Quote(Actor->GetClass()->GetName()) + TEXT(")"));
		Lines.Add(Indent(1) + TEXT("(class-path ") + Quote(Actor->GetClass()->GetPathName()) + TEXT(")"));
		Lines.Add(Indent(1) + TEXT("(package ") + Quote(Actor->GetPackage()->GetName()) + TEXT(")"));
		if (!Actor->GetFolderPath().IsNone())
		{
			Lines.Add(Indent(1) + TEXT("(folder ") + Quote(Actor->GetFolderPath().ToString()) + TEXT(")"));
		}
	};

	// A new actor is compared against the defaults of its class, so the diff lists what was set
	// after placing it.
	TArray<FString> Lines;
	AddHeader(TEXT("actor-diff"), Lines);
	Lines.Add(Indent(1) + RevisionLine);
	if (!Old)
	{
		Lines.Add(Indent(1) + TEXT("(baseline class-default)"));
	}
	Lines.Add(Indent(1) + TEXT("(new working-copy)"));
	if (Old)
	{
		Lines.Add(Indent(1) + TransformExpr(TEXT("old-transform"), Old));
	}
	Lines.Add(Indent(1) + TransformExpr(TEXT("transform"), Actor));
	AddPropertyDiffs(Old ? Old : ClassDefault, Actor, false, Lines);
	Lines.Last() += TEXT(")");

	TArray<FString> Reference;
	AddHeader(TEXT("actor"), Reference);
	Reference.Add(Indent(1) + TEXT("(revision working-copy)"));
	Reference.Add(Indent(1) + TransformExpr(TEXT("transform"), Actor));
	AddPropertyDiffs(ClassDefault, Actor, true, Reference);
	Reference.Last() += TEXT(")");

	return WriteLines(Lines, OutPath, OutError)
		&& WriteLines(Reference, OutputPathFor(FileName, TEXT("Doc/commits/Transient/graph/reference")), OutError);
}

bool ExportDiff(UBlueprint* Blueprint, FString& OutPath, FString& OutError)
{
	if (!Blueprint)
	{
		OutError = TEXT("No Blueprint selected.");
		return false;
	}

	const FString PackageName = Blueprint->GetOutermost()->GetName();
	OutPath = OutputPathFor(PackageName, TEXT("Doc/commits/Transient/graph/transient"));

	FString RevisionLine;
	UBlueprint* OldBlueprint = Cast<UBlueprint>(LoadDepotRevision(Blueprint, RevisionLine, OutError));
	if (!OutError.IsEmpty())
	{
		return false;
	}

	TArray<FString> Lines;
	Lines.Add(TEXT("(blueprint-diff ") + Quote(PackageName));
	Lines.Add(Indent(1) + RevisionLine);
	Lines.Add(Indent(1) + TEXT("(new working-copy)"));
	Lines.Add(Indent(1) + TEXT("(parent ") + Quote(Blueprint->ParentClass ? Blueprint->ParentClass->GetPathName() : FString()) + TEXT(")"));

	AddVariableDiffs(OldBlueprint, Blueprint, Lines);
	AddDefaultsDiffs(OldBlueprint, Blueprint, false, Lines);
	AddComponentDiffs(OldBlueprint, Blueprint, false, Lines);

	const TMap<FString, UEdGraph*> OldGraphs = GraphsByPath(OldBlueprint);
	const TMap<FString, UEdGraph*> NewGraphs = GraphsByPath(Blueprint);
	TSet<FString> Paths;
	for (const TPair<FString, UEdGraph*>& Pair : OldGraphs) { Paths.Add(Pair.Key); }
	for (const TPair<FString, UEdGraph*>& Pair : NewGraphs) { Paths.Add(Pair.Key); }
	TArray<FString> SortedPaths = Paths.Array();
	SortedPaths.Sort();

	for (const FString& Path : SortedPaths)
	{
		UEdGraph* const* OldGraph = OldGraphs.Find(Path);
		UEdGraph* const* NewGraph = NewGraphs.Find(Path);
		AddGraphDiffs(Path, OldGraph ? *OldGraph : nullptr, NewGraph ? *NewGraph : nullptr, Lines);
	}
	Lines.Last() += TEXT(")");

	return WriteLines(Lines, OutPath, OutError)
		&& WriteLines(ReferenceLines(Blueprint), OutputPathFor(PackageName, TEXT("Doc/commits/Transient/graph/reference")), OutError);
}
}
