CREATE TABLE "hub_members" (
	"hub_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"rank" integer,
	CONSTRAINT "hub_members_hub_id_entry_id_pk" PRIMARY KEY("hub_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "hubs" (
	"hub_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"member_count" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hub_members_hub_rank_entry_idx" ON "hub_members" USING btree ("hub_id","rank","entry_id");--> statement-breakpoint
CREATE INDEX "hub_members_entry_id_idx" ON "hub_members" USING btree ("entry_id");