CREATE TYPE "public"."autocomplete_rule" AS ENUM('off', 'on', 'user_choice');--> statement-breakpoint
ALTER TABLE "contests" ADD COLUMN "autocomplete" "autocomplete_rule" DEFAULT 'user_choice' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "practice_hidden" boolean DEFAULT false NOT NULL;