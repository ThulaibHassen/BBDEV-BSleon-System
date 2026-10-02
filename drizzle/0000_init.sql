CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"who" integer,
	"t" text NOT NULL,
	"m" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"studio" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_logins" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"username" text NOT NULL,
	"status" text DEFAULT 'never' NOT NULL,
	"last_active" date,
	"sessions" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"code_hash" text,
	"code_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_logins_status_ck" CHECK ("app_logins"."status" in ('active','never','locked'))
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"date" date NOT NULL,
	"present" boolean NOT NULL,
	"marked_by" integer
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"realm" text NOT NULL,
	"principal_id" integer NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"child_student_id" integer,
	"refresh_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"last_used_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"ch" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"sort" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"student_id" integer NOT NULL,
	"month" text NOT NULL,
	"mood" text NOT NULL,
	"blocker" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkins_student_id_month_pk" PRIMARY KEY("student_id","month")
);
--> statement-breakpoint
CREATE TABLE "class_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"cohort" smallint NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"student_id" integer,
	"staff_id" integer,
	"as_staff" boolean DEFAULT false NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'paper' NOT NULL,
	"year" smallint,
	"part" smallint,
	"lang" text DEFAULT 'en' NOT NULL,
	"source" text DEFAULT 'orig' NOT NULL,
	"unit" text,
	"cohort" smallint,
	"audience" text DEFAULT 'students' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"available_from" timestamp with time zone,
	"available_until" timestamp with time zone,
	"pair_id" integer,
	"storage_key" text NOT NULL,
	"original_name" text,
	"bytes" integer DEFAULT 0 NOT NULL,
	"pages" smallint,
	"has_text" boolean DEFAULT false NOT NULL,
	"sha256" text NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_kind_ck" CHECK ("documents"."kind" in ('paper','scheme','tute','mcq','target','guide','other')),
	CONSTRAINT "documents_audience_ck" CHECK ("documents"."audience" in ('public','students','staff')),
	CONSTRAINT "documents_part_ck" CHECK ("documents"."part" is null or "documents"."part" in (1,2))
);
--> statement-breakpoint
CREATE TABLE "essay_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"unit" text,
	"cohort" smallint,
	"marks" smallint DEFAULT 15 NOT NULL,
	"question" text,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"published" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"student_id" integer,
	"cust" text NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"due" date,
	"method" text DEFAULT '-' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"realm" text DEFAULT 'staff' NOT NULL,
	"staff_id" integer,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"ip" text,
	"ok" boolean DEFAULT true NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcq_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"paper_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"seconds" integer,
	"correct" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"marks" integer DEFAULT 0 NOT NULL,
	"max_marks" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"late" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcq_papers" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'paper' NOT NULL,
	"mode" text DEFAULT 'questions' NOT NULL,
	"document_id" integer,
	"unit" text,
	"cohort" smallint,
	"minutes" integer DEFAULT 15 NOT NULL,
	"instructions" text,
	"published" boolean DEFAULT false NOT NULL,
	"shuffle" boolean DEFAULT false NOT NULL,
	"open_from" timestamp with time zone,
	"open_to" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcq_papers_kind_ck" CHECK ("mcq_papers"."kind" in ('paper','drill')),
	CONSTRAINT "mcq_papers_mode_ck" CHECK ("mcq_papers"."mode" in ('questions','pdf'))
);
--> statement-breakpoint
CREATE TABLE "mcq_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"paper_id" integer NOT NULL,
	"ord" integer DEFAULT 1 NOT NULL,
	"q" text NOT NULL,
	"image_media_id" integer,
	"opts" text[] NOT NULL,
	"answer" smallint NOT NULL,
	"why" text,
	"marks" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"purpose" text DEFAULT 'mcq' NOT NULL,
	"sha256" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_recipients" (
	"message_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"read_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	CONSTRAINT "message_recipients_message_id_student_id_pk" PRIMARY KEY("message_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"aud" text NOT NULL,
	"aud_label" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"sched_for" timestamp with time zone,
	"by" integer,
	"sent" integer DEFAULT 0 NOT NULL,
	"opened" integer DEFAULT 0 NOT NULL,
	"registered" integer,
	"status" text DEFAULT 'sent' NOT NULL,
	"courier" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"date" date NOT NULL,
	"paper" text NOT NULL,
	"q" text DEFAULT '' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"max" integer DEFAULT 0 NOT NULL,
	"timed" boolean DEFAULT false NOT NULL,
	"marker" text DEFAULT 'self' NOT NULL,
	"err" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_logins" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"label" text DEFAULT 'Parent' NOT NULL,
	"code_hash" text,
	"code_expires" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_active" date,
	"sessions" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"details" text,
	"price" integer DEFAULT 0 NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"threshold" integer DEFAULT 5 NOT NULL,
	"photo_media_id" integer,
	"last_sold" date
);
--> statement-breakpoint
CREATE TABLE "push_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"audience" text DEFAULT 'student' NOT NULL,
	"kind" text NOT NULL,
	"ref" text,
	"title" text,
	"body" text,
	"devices" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"audience" text DEFAULT 'student' NOT NULL,
	"student_id" integer,
	"parent_id" integer,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"ua" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok" timestamp with time zone,
	"fails" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_answers" (
	"game_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"choice" smallint NOT NULL,
	"ms" integer NOT NULL,
	"correct" boolean NOT NULL,
	"points" integer NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_answers_game_id_question_id_student_id_pk" PRIMARY KEY("game_id","question_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "quiz_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"quiz_id" integer NOT NULL,
	"pin" text NOT NULL,
	"host_staff" integer,
	"cohort" smallint,
	"state" text DEFAULT 'lobby' NOT NULL,
	"q_index" integer DEFAULT -1 NOT NULL,
	"q_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quiz_players" (
	"game_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"nickname" text NOT NULL,
	"avatar" text DEFAULT 'bulb' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_players_game_id_student_id_pk" PRIMARY KEY("game_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"quiz_id" integer NOT NULL,
	"ord" integer DEFAULT 1 NOT NULL,
	"q" text NOT NULL,
	"opts" text[] NOT NULL,
	"answer" smallint NOT NULL,
	"seconds" integer DEFAULT 20 NOT NULL,
	"points_x" smallint DEFAULT 1 NOT NULL,
	"why" text
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"unit" text,
	"cohort" smallint,
	"note" text,
	"published" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recording_views" (
	"recording_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recording_views_recording_id_student_id_pk" PRIMARY KEY("recording_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"cohort" smallint NOT NULL,
	"loc" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"mins" integer,
	"added_by" text DEFAULT '' NOT NULL,
	"added_on" date NOT NULL,
	"release" text DEFAULT 'absent' NOT NULL,
	"window_days" integer DEFAULT 14 NOT NULL,
	"grants" integer[] DEFAULT '{}'::int[] NOT NULL,
	"revoked" integer[] DEFAULT '{}'::int[] NOT NULL,
	"views" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"co" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"owner" integer,
	"value" integer,
	"follow_up" date,
	"created_on" date NOT NULL,
	"lost_reason" text,
	"rev" jsonb,
	"acts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"batch" smallint,
	"prog" text,
	"school" text,
	"student_id" integer,
	"ext_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"month" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"paid_at" date,
	"method" text DEFAULT 'Cash' NOT NULL,
	"receipt_no" text,
	"recorded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_plans" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"cohort" smallint DEFAULT 0 NOT NULL,
	"program" text DEFAULT 'Theory' NOT NULL,
	"loc" text DEFAULT 'Kings' NOT NULL,
	"fee" integer,
	"joined" date,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" text DEFAULT 'staff' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_role_ck" CHECK ("staff"."role" in ('owner','manager','staff'))
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"program" text DEFAULT 'Theory' NOT NULL,
	"cohort" smallint DEFAULT 0 NOT NULL,
	"loc" text DEFAULT 'Kings' NOT NULL,
	"co" text DEFAULT '' NOT NULL,
	"joined" date,
	"status" text DEFAULT 'active' NOT NULL,
	"level" text DEFAULT 'okay' NOT NULL,
	"fee" integer,
	"owner" integer,
	"last_seen" date,
	"sent" integer DEFAULT 0 NOT NULL,
	"snooze" date,
	"school" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"t" text NOT NULL,
	"who" integer,
	"due" date,
	"due_time" text,
	"note" text,
	"d" boolean DEFAULT false NOT NULL,
	"done_on" date,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_checks" (
	"student_id" integer NOT NULL,
	"kind" text NOT NULL,
	"topic" text NOT NULL,
	"state" text NOT NULL,
	"checked_at" date NOT NULL,
	CONSTRAINT "topic_checks_student_id_kind_topic_pk" PRIMARY KEY("student_id","kind","topic")
);
--> statement-breakpoint
CREATE TABLE "tute_assign" (
	"unit" text NOT NULL,
	"cohort" smallint NOT NULL,
	"date" date NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"document_id" integer,
	CONSTRAINT "tute_assign_unit_cohort_date_pk" PRIMARY KEY("unit","cohort","date")
);
--> statement-breakpoint
CREATE TABLE "tutes" (
	"student_id" integer NOT NULL,
	"unit" text NOT NULL,
	"state" text DEFAULT 'assigned' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutes_student_id_unit_pk" PRIMARY KEY("student_id","unit")
);
--> statement-breakpoint
CREATE TABLE "unit_weights" (
	"unit" text PRIMARY KEY NOT NULL,
	"band" text DEFAULT 'medium' NOT NULL,
	"share" smallint,
	"note" text,
	"published" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_weights_band_ck" CHECK ("unit_weights"."band" in ('high','medium','low')),
	CONSTRAINT "unit_weights_share_ck" CHECK ("unit_weights"."share" is null or ("unit_weights"."share" between 0 and 100))
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_who_staff_id_fk" FOREIGN KEY ("who") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_logins" ADD CONSTRAINT "app_logins_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_log" ADD CONSTRAINT "document_log_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcq_attempts" ADD CONSTRAINT "mcq_attempts_paper_id_mcq_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."mcq_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcq_attempts" ADD CONSTRAINT "mcq_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcq_questions" ADD CONSTRAINT "mcq_questions_paper_id_mcq_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."mcq_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_by_staff_id_fk" FOREIGN KEY ("by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_attempts" ADD CONSTRAINT "paper_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_logins" ADD CONSTRAINT "parent_logins_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subs" ADD CONSTRAINT "push_subs_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subs" ADD CONSTRAINT "push_subs_parent_id_parent_logins_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parent_logins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_game_id_quiz_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."quiz_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_question_id_quiz_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_games" ADD CONSTRAINT "quiz_games_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_players" ADD CONSTRAINT "quiz_players_game_id_quiz_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."quiz_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_views" ADD CONSTRAINT "recording_views_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_views" ADD CONSTRAINT "recording_views_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_owner_staff_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_plan_id_recurring_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."recurring_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_plans" ADD CONSTRAINT "recurring_plans_id_students_id_fk" FOREIGN KEY ("id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_owner_staff_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_who_staff_id_fk" FOREIGN KEY ("who") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_checks" ADD CONSTRAINT "topic_checks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutes" ADD CONSTRAINT "tutes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_at" ON "activity" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_logins_student_uq" ON "app_logins" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_logins_username_uq" ON "app_logins" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_student_date_uq" ON "attendance" USING btree ("student_id","date");--> statement-breakpoint
CREATE INDEX "attendance_date" ON "attendance" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_refresh_uq" ON "auth_sessions" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_principal" ON "auth_sessions" USING btree ("realm","principal_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_family" ON "auth_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_log_date_cohort_uq" ON "class_log" USING btree ("date","cohort");--> statement-breakpoint
CREATE INDEX "document_log_doc" ON "document_log" USING btree ("document_id","issued_at");--> statement-breakpoint
CREATE INDEX "document_log_student" ON "document_log" USING btree ("student_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_key_uq" ON "documents" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "documents_list" ON "documents" USING btree ("published","kind","year");--> statement-breakpoint
CREATE INDEX "login_audit_at" ON "login_audit" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "mcq_attempts_one_uq" ON "mcq_attempts" USING btree ("paper_id","student_id");--> statement-breakpoint
CREATE INDEX "mcq_attempts_student" ON "mcq_attempts" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "mcq_questions_ord" ON "mcq_questions" USING btree ("paper_id","ord");--> statement-breakpoint
CREATE UNIQUE INDEX "media_storage_key_uq" ON "media" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "message_recipients_student" ON "message_recipients" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "messages_status" ON "messages" USING btree ("status","sched_for");--> statement-breakpoint
CREATE INDEX "paper_attempts_student" ON "paper_attempts" USING btree ("student_id","date");--> statement-breakpoint
CREATE INDEX "parent_logins_student" ON "parent_logins" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "push_log_student_day" ON "push_log" USING btree ("student_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subs_endpoint_uq" ON "push_subs" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subs_student" ON "push_subs" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "push_subs_parent" ON "push_subs" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_games_pin_uq" ON "quiz_games" USING btree ("pin");--> statement-breakpoint
CREATE INDEX "quiz_games_state" ON "quiz_games" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "quiz_questions_ord" ON "quiz_questions" USING btree ("quiz_id","ord");--> statement-breakpoint
CREATE INDEX "recordings_cohort_date" ON "recordings" USING btree ("cohort","date");--> statement-breakpoint
CREATE INDEX "records_owner_stage" ON "records" USING btree ("owner","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "records_ext_ref_uq" ON "records" USING btree ("ext_ref");--> statement-breakpoint
CREATE INDEX "recurring_payments_plan_month" ON "recurring_payments" USING btree ("plan_id","month");--> statement-breakpoint
CREATE INDEX "recurring_payments_month" ON "recurring_payments" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_uq" ON "staff" USING btree ("email");--> statement-breakpoint
CREATE INDEX "students_cohort" ON "students" USING btree ("cohort","status");--> statement-breakpoint
CREATE INDEX "students_owner" ON "students" USING btree ("owner");