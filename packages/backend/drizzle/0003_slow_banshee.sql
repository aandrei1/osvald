CREATE TYPE "public"."script_stage" AS ENUM('extracting', 'in_review', 'synthesizing', 'paused_budget', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "stage" "script_stage" DEFAULT 'extracting' NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "run_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
-- Old statuses map onto the new stages: a parsed script is waiting for review,
-- a queued or running parse is still extracting. The recovery job re-queues
-- the extracting ones, since their old jobs carry no run id.
UPDATE "scripts" SET
  "stage" = CASE "status"
    WHEN 'parsed' THEN 'in_review'::"script_stage"
    WHEN 'failed' THEN 'failed'::"script_stage"
    ELSE 'extracting'::"script_stage"
  END,
  "stage_entered_at" = "updated_at";--> statement-breakpoint
CREATE INDEX "scripts_stage_stage_entered_at_idx" ON "scripts" USING btree ("stage","stage_entered_at");