#include "BlueprintDiffWriter.h"

#include "DiffResults.h"
#include "DiffUtils.h"
#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphNode.h"
#include "EdGraph/EdGraphPin.h"
#include "EdGraphSchema_K2.h"
#include "Engine/Blueprint.h"
#include "GraphDiffControl.h"
#include "ISourceControlModule.h"
#include "ISourceControlProvider.h"
#include "ISourceControlRevision.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
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

	/** Every pin of a node, with its type, default value and links. */
	void AddNodeDetails(const UEdGraphNode* Node, int32 Depth, TArray<FString>& Lines)
	{
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

	void AddDefaultsDiffs(const UBlueprint* OldBlueprint, const UBlueprint* NewBlueprint, TArray<FString>& Lines)
	{
		const UObject* OldDefaults = OldBlueprint ? DiffUtils::GetCDO(OldBlueprint) : nullptr;
		const UObject* NewDefaults = DiffUtils::GetCDO(NewBlueprint);
		if (!OldDefaults || !NewDefaults)
		{
			return;
		}

		TArray<FSingleObjectDiffEntry> Differences;
		DiffUtils::CompareUnrelatedObjects(OldDefaults, NewDefaults, Differences);

		const FString OldPackage = OldBlueprint->GetOutermost()->GetName();
		const FString NewPackage = NewBlueprint->GetOutermost()->GetName();

		TArray<FString> Entries;
		for (const FSingleObjectDiffEntry& Difference : Differences)
		{
			const TCHAR* Kind =
				Difference.DiffType == EPropertyDiffType::PropertyAddedToA ? TEXT("removed") :
				Difference.DiffType == EPropertyDiffType::PropertyAddedToB ? TEXT("added") : TEXT("changed");
			Entries.Add(FString::Printf(TEXT("%s(%s %s (old %s) (new %s))"),
				*Indent(2), Kind,
				*Quote(Difference.Identifier.ToDisplayName()),
				*PropertyValueText(Difference.Identifier, OldDefaults, OldPackage, NewPackage),
				*PropertyValueText(Difference.Identifier, NewDefaults, OldPackage, NewPackage)));
		}

		if (!Entries.IsEmpty())
		{
			Lines.Add(Indent(1) + TEXT("(defaults"));
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

	/** Loads the latest revision of the Blueprint from revision control, or returns null if there is none. */
	UBlueprint* LoadDepotRevision(const UBlueprint* Blueprint, FString& OutRevisionLine, FString& OutError)
	{
		ISourceControlModule& SourceControl = ISourceControlModule::Get();
		if (!SourceControl.IsEnabled() || !SourceControl.GetProvider().IsAvailable())
		{
			OutError = TEXT("Revision control is not enabled or not available.");
			return nullptr;
		}

		ISourceControlProvider& Provider = SourceControl.GetProvider();
		const FString PackageName = Blueprint->GetOutermost()->GetName();
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
		return Cast<UBlueprint>(OldObject);
	}
}

bool ExportDiff(UBlueprint* Blueprint, FString& OutPath, FString& OutError)
{
	if (!Blueprint)
	{
		OutError = TEXT("No Blueprint selected.");
		return false;
	}

	const FString PackageName = Blueprint->GetOutermost()->GetName();
	OutPath = OutputPathFor(PackageName, TEXT("Doc/graph/transient"));

	FString RevisionLine;
	UBlueprint* OldBlueprint = LoadDepotRevision(Blueprint, RevisionLine, OutError);
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
	AddDefaultsDiffs(OldBlueprint, Blueprint, Lines);

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
		&& WriteLines(ReferenceLines(Blueprint), OutputPathFor(PackageName, TEXT("Doc/graph/reference")), OutError);
}
}
