CREATE TYPE "public"."workspace_role" AS ENUM('editor', 'member');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "scripts_user_id_idx";--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
-- Every existing account gets a personal workspace in which it is the editor,
-- and its scripts move there. `created_by` links each new workspace to its
-- user, since each user has exactly one at this point.
INSERT INTO "workspaces" ("name", "created_by", "created_at", "updated_at")
SELECT coalesce(nullif(trim("display_name"), ''), split_part("email", '@', 1)) || '''s workspace',
       "id", "created_at", "created_at"
FROM "users";--> statement-breakpoint
INSERT INTO "workspace_members" ("workspace_id", "user_id", "role", "joined_at")
SELECT "id", "created_by", 'editor', "created_at" FROM "workspaces";--> statement-breakpoint
UPDATE "scripts" SET "workspace_id" = "workspaces"."id"
FROM "workspaces"
WHERE "workspaces"."created_by" = "scripts"."user_id";--> statement-breakpoint
-- Anonymous scripts (no uploader) belong to nobody, so they go. Their PDFs stay
-- in UPLOAD_DIR; none existed when this was written.
DELETE FROM "scripts" WHERE "workspace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "scripts" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_open_workspace_id_email_unique" ON "invitations" USING btree ("workspace_id","email") WHERE "invitations"."accepted_at" IS NULL AND "invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_one_editor_unique" ON "workspace_members" USING btree ("workspace_id") WHERE "workspace_members"."role" = 'editor';--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scripts_workspace_id_created_at_idx" ON "scripts" USING btree ("workspace_id","created_at");