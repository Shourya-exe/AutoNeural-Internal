"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { changeStageAction } from "@/app/(app)/leads/actions";
import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";

export interface BoardCard {
  id: string;
  contactName: string;
  company: string | null;
  service: string | null;
  owner: string | null;
  value: string;
  nextFollowUp: string | null;
  overdue: boolean;
  stageId: string;
}

export interface BoardStage {
  id: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
}

export function PipelineBoard({
  stages,
  cards: initialCards,
}: {
  stages: BoardStage[];
  cards: BoardCard[];
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initialCards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lostPrompt, setLostPrompt] = useState<{ leadId: string; stageId: string } | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const leadId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;

    const card = cards.find((c) => c.id === leadId);
    if (!card || card.stageId === overId) return;

    const target = stages.find((s) => s.id === overId);
    if (target?.isLost) {
      setLostPrompt({ leadId, stageId: overId });
      return;
    }
    move(leadId, overId);
  }

  function move(leadId: string, stageId: string, lostReason?: string) {
    const prev = cards;
    setCards((cs) => cs.map((c) => (c.id === leadId ? { ...c, stageId } : c)));
    start(async () => {
      const res = await changeStageAction(leadId, stageId, lostReason);
      if (!res.ok) {
        setCards(prev); // rollback — the move was NOT persisted
        setErr(res.error);
      } else {
        setErr(null);
        router.refresh();
      }
    });
  }

  const activeCard = cards.find((c) => c.id === activeId) ?? null;

  return (
    <>
      {err && (
        <p className="mb-3 rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-600">{err}</p>
      )}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const stageCards = cards.filter((c) => c.stageId === stage.id);
            return (
              <Column key={stage.id} stage={stage} count={stageCards.length}>
                {stageCards.map((c) => (
                  <DraggableCard key={c.id} card={c} />
                ))}
              </Column>
            );
          })}
        </div>
        <DragOverlay>
          {activeCard ? <CardBody card={activeCard} dragging /> : null}
        </DragOverlay>
      </DndContext>

      <Dialog
        open={!!lostPrompt}
        onClose={() => {
          setLostPrompt(null);
          setReason("");
        }}
        title="Mark opportunity as Lost"
        description="A reason is required and is recorded on the activity timeline."
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Reason</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Budget too high"
              autoFocus
            />
          </div>
          <Button
            className="w-full"
            disabled={!reason.trim() || pending}
            onClick={() => {
              if (!lostPrompt) return;
              move(lostPrompt.leadId, lostPrompt.stageId, reason.trim());
              setLostPrompt(null);
              setReason("");
            }}
          >
            {pending ? "Saving…" : "Mark Lost"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function Column({
  stage,
  count,
  children,
}: {
  stage: BoardStage;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[266px] shrink-0 flex-col rounded-lg border bg-card transition-colors",
        isOver ? "border-gold bg-gold/5" : "border-border",
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2 rounded-full",
              stage.isWon ? "bg-emerald" : stage.isLost ? "bg-danger" : "bg-gold",
            )}
          />
          <span className="text-xs font-semibold text-espresso-700">{stage.name}</span>
        </div>
        <Badge variant="muted">{count}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">{children}</div>
    </div>
  );
}

function DraggableCard({ card }: { card: BoardCard }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <CardBody card={card} handleProps={{ ...listeners, ...attributes }} />
    </div>
  );
}

function CardBody({
  card,
  dragging,
  handleProps,
}: {
  card: BoardCard;
  dragging?: boolean;
  handleProps?: Record<string, unknown>;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface p-2.5 shadow-sm",
        dragging && "rotate-1 shadow-pop",
      )}
    >
      <div className="flex items-start gap-1.5">
        <button
          {...handleProps}
          className="mt-0.5 cursor-grab touch-none text-espresso-300 active:cursor-grabbing"
          aria-label="Drag"
        >
          <GripVertical className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <Link
            href={`/leads/${card.id}`}
            className="block truncate text-xs font-medium text-espresso hover:text-gold-700"
          >
            {card.contactName}
          </Link>
          <p className="truncate text-[10px] text-muted-foreground">{card.company ?? "—"}</p>
          <p className="mt-1 truncate text-[10px] text-espresso-500">{card.service ?? "Service not set"}</p>
          <div className="mt-1.5 flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold tabular-nums text-espresso-700">
              {card.value}
            </span>
            <span className="truncate text-[10px] text-muted-foreground">
              {card.owner ?? "Unassigned"}
            </span>
          </div>
          {card.nextFollowUp && (
            <Badge variant={card.overdue ? "danger" : "muted"} className="mt-1.5">
              {card.overdue ? "Overdue · " : "Next · "}
              {card.nextFollowUp}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
