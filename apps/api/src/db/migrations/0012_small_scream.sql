CREATE TABLE "card_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"concept" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_card_id" uuid NOT NULL,
	"target_card_id" uuid NOT NULL,
	"link_type" varchar(20) DEFAULT 'related' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_card_link" UNIQUE("source_card_id","target_card_id"),
	CONSTRAINT "chk_no_self_link" CHECK ("card_links"."source_card_id" != "card_links"."target_card_id")
);
--> statement-breakpoint
ALTER TABLE "card_concepts" ADD CONSTRAINT "card_concepts_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_source_card_id_cards_id_fk" FOREIGN KEY ("source_card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_target_card_id_cards_id_fk" FOREIGN KEY ("target_card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_card_concepts_card_id" ON "card_concepts" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "idx_card_concepts_concept" ON "card_concepts" USING btree ("concept");--> statement-breakpoint
CREATE INDEX "idx_card_links_source" ON "card_links" USING btree ("source_card_id");--> statement-breakpoint
CREATE INDEX "idx_card_links_target" ON "card_links" USING btree ("target_card_id");