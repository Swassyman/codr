CREATE TYPE "public"."contest_scoring" AS ENUM('all_or_nothing', 'partial');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."reveal_hidden" AS ENUM('during', 'after');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'creator', 'participant');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('custom', 'samples', 'generate', 'validate');--> statement-breakpoint
CREATE TYPE "public"."scoring_mode" AS ENUM('tests', 'groups');--> statement-breakpoint
CREATE TYPE "public"."timing_mode" AS ENUM('per_question', 'fixed_window', 'personal_window');--> statement-breakpoint
CREATE TYPE "public"."verdict_detail" AS ENUM('per_test', 'summary');--> statement-breakpoint
CREATE TYPE "public"."contest_visibility" AS ENUM('public', 'invite', 'private');--> statement-breakpoint
CREATE TABLE "contest_questions" (
	"contest_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"position" integer NOT NULL,
	"points" integer,
	"duration_minutes" integer,
	CONSTRAINT "contest_questions_contest_id_question_id_pk" PRIMARY KEY("contest_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "contests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(160) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"visibility" "contest_visibility" DEFAULT 'public' NOT NULL,
	"join_code" varchar(32) NOT NULL,
	"allow_guests" boolean DEFAULT false NOT NULL,
	"registration_open" boolean DEFAULT true NOT NULL,
	"allowed_languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"timing_mode" "timing_mode" DEFAULT 'fixed_window' NOT NULL,
	"duration_minutes" integer,
	"default_question_minutes" integer,
	"view_once" boolean DEFAULT false NOT NULL,
	"sequential" boolean DEFAULT false NOT NULL,
	"max_submissions_per_question" integer,
	"max_runs_per_minute" integer,
	"reveal_hidden" "reveal_hidden" DEFAULT 'during' NOT NULL,
	"verdict_detail" "verdict_detail" DEFAULT 'per_test' NOT NULL,
	"scoring" "contest_scoring" DEFAULT 'partial' NOT NULL,
	"penalty_minutes" integer,
	"leaderboard_enabled" boolean DEFAULT false NOT NULL,
	"leaderboard_freeze_minutes" integer,
	"record_integrity" boolean DEFAULT false NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contests_joinCode_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"contest_id" integer,
	"question_id" integer NOT NULL,
	"language" varchar(16) NOT NULL,
	"code" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "drafts_userId_contestId_questionId_language_unique" UNIQUE NULLS NOT DISTINCT("user_id","contest_id","question_id","language")
);
--> statement-breakpoint
CREATE TABLE "import_cache" (
	"key" varchar(300) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrity_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "integrity_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contest_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"question_id" integer,
	"type" varchar(24) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_time" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participant_questions" (
	"participant_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"first_viewed_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"expiry_processed_at" timestamp with time zone,
	CONSTRAINT "participant_questions_participant_id_question_id_pk" PRIMARY KEY("participant_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "participants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"contest_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entered_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "participants_contestId_userId_unique" UNIQUE("contest_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "questions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(96) NOT NULL,
	"title" varchar(200) NOT NULL,
	"difficulty" "difficulty",
	"rating" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"statement" text DEFAULT '' NOT NULL,
	"input_format" text DEFAULT '' NOT NULL,
	"output_format" text DEFAULT '' NOT NULL,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"samples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"time_limit_ms" integer DEFAULT 2000 NOT NULL,
	"memory_limit_mb" integer DEFAULT 256 NOT NULL,
	"language_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"starter_code" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"points" integer DEFAULT 100 NOT NULL,
	"scoring_mode" "scoring_mode" DEFAULT 'tests' NOT NULL,
	"checker" jsonb DEFAULT '{"type":"trim"}'::jsonb NOT NULL,
	"reference_solution" jsonb,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"practice" boolean DEFAULT false NOT NULL,
	"source" jsonb,
	"validation" jsonb,
	"judge_data_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"contest_id" integer,
	"question_id" integer,
	"kind" "run_kind" NOT NULL,
	"language" varchar(16) NOT NULL,
	"code" text NOT NULL,
	"input" text,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"contest_id" integer,
	"question_id" integer NOT NULL,
	"language" varchar(16) NOT NULL,
	"code" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"verdict" varchar(4),
	"fraction" real,
	"score" real,
	"max_score" real DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"time_ms" integer,
	"memory_kb" integer,
	"compile_output" text,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"judged_at" timestamp with time zone,
	"is_auto" boolean DEFAULT false NOT NULL,
	"idempotency_key" varchar(64),
	CONSTRAINT "submissions_userId_idempotencyKey_unique" UNIQUE("user_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"question_id" integer NOT NULL,
	"position" integer NOT NULL,
	"input" text DEFAULT '' NOT NULL,
	"expected_output" text DEFAULT '' NOT NULL,
	"hidden" boolean DEFAULT true NOT NULL,
	"points" real,
	"label" varchar(120),
	"group_name" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" varchar(64) NOT NULL,
	"email" varchar(254),
	"display_name" varchar(80) NOT NULL,
	"password_hash" text,
	"role" "role" DEFAULT 'participant' NOT NULL,
	"is_guest" boolean DEFAULT false NOT NULL,
	"guest_contest_id" integer,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "contest_questions" ADD CONSTRAINT "contest_questions_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contest_questions" ADD CONSTRAINT "contest_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contests" ADD CONSTRAINT "contests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_events" ADD CONSTRAINT "integrity_events_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_questions" ADD CONSTRAINT "participant_questions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_questions" ADD CONSTRAINT "participant_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_guest_contest_id_contests_id_fk" FOREIGN KEY ("guest_contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contests_status_starts_at_index" ON "contests" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "integrity_events_contest_id_user_id_index" ON "integrity_events" USING btree ("contest_id","user_id");--> statement-breakpoint
CREATE INDEX "questions_status_index" ON "questions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "questions_author_id_index" ON "questions" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "runs_status_id_index" ON "runs" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "runs_user_id_created_at_index" ON "runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "submissions_contest_id_user_id_question_id_index" ON "submissions" USING btree ("contest_id","user_id","question_id");--> statement-breakpoint
CREATE INDEX "submissions_status_id_index" ON "submissions" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "test_cases_question_id_position_index" ON "test_cases" USING btree ("question_id","position");