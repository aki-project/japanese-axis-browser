CREATE TABLE "components" (
	"character" text PRIMARY KEY NOT NULL,
	"is_kanji" boolean NOT NULL,
	"etymology" text
);
--> statement-breakpoint
CREATE TABLE "kanji" (
	"literal" text PRIMARY KEY NOT NULL,
	"on_readings" text[] DEFAULT '{}' NOT NULL,
	"kun_readings" text[] DEFAULT '{}' NOT NULL,
	"meanings" text[] DEFAULT '{}' NOT NULL,
	"stroke_count" integer NOT NULL,
	"radical" text,
	"components" text[] DEFAULT '{}' NOT NULL,
	"etymology" text,
	"jlpt_level" text,
	"frequency" integer
);
--> statement-breakpoint
CREATE TABLE "links" (
	"from_entry_id" text NOT NULL,
	"to_entry_id" text NOT NULL,
	"axis" text NOT NULL,
	"relation" text NOT NULL,
	"weight" real,
	"source" text NOT NULL,
	CONSTRAINT "links_from_entry_id_to_entry_id_axis_relation_pk" PRIMARY KEY("from_entry_id","to_entry_id","axis","relation")
);
--> statement-breakpoint
CREATE TABLE "radicals" (
	"character" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"stroke_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sentence_entries" (
	"sentence_id" integer NOT NULL,
	"entry_id" text NOT NULL,
	CONSTRAINT "sentence_entries_sentence_id_entry_id_pk" PRIMARY KEY("sentence_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "sentences" (
	"tatoeba_id" integer PRIMARY KEY NOT NULL,
	"japanese" text NOT NULL,
	"english" text NOT NULL,
	"furigana" jsonb NOT NULL,
	"licence" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary_items" (
	"ent_seq" integer PRIMARY KEY NOT NULL,
	"surface" text NOT NULL,
	"reading" text NOT NULL,
	"alternate_surfaces" text[] DEFAULT '{}' NOT NULL,
	"alternate_readings" text[] DEFAULT '{}' NOT NULL,
	"meanings" text[] DEFAULT '{}' NOT NULL,
	"parts_of_speech" text[] DEFAULT '{}' NOT NULL,
	"jlpt_level" text,
	"is_common" boolean DEFAULT false NOT NULL,
	"audio_url" text,
	"search_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sentence_entries" ADD CONSTRAINT "sentence_entries_sentence_id_sentences_tatoeba_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."sentences"("tatoeba_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kanji_on_readings_gin" ON "kanji" USING gin ("on_readings");--> statement-breakpoint
CREATE INDEX "kanji_kun_readings_gin" ON "kanji" USING gin ("kun_readings");--> statement-breakpoint
CREATE INDEX "links_from_entry_axis_idx" ON "links" USING btree ("from_entry_id","axis");--> statement-breakpoint
CREATE INDEX "sentence_entries_entry_id_idx" ON "sentence_entries" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "vocabulary_items_search_key_idx" ON "vocabulary_items" USING btree ("search_key");