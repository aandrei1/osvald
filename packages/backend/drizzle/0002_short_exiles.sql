CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."gender_source" AS ENUM('auto', 'manual');--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "gender" "gender" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "gender_source" "gender_source" DEFAULT 'auto' NOT NULL;