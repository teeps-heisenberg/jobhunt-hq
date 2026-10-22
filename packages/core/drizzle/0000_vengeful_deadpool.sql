CREATE TABLE `artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL,
	`verify_items` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_job_idx` ON `artifacts` (`job_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`at` text NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_job_idx` ON `events` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`location` text NOT NULL,
	`region` text,
	`remote` integer DEFAULT false NOT NULL,
	`visa_note` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`apply_url` text,
	`salary_text` text,
	`score` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'New' NOT NULL,
	`found_at` text NOT NULL,
	`posted_at` text,
	`why` text DEFAULT '' NOT NULL,
	`gaps` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`batch` text,
	`applied_at` text,
	`follow_up_at` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company`);--> statement-breakpoint
CREATE INDEX `jobs_url_idx` ON `jobs` (`url`);--> statement-breakpoint
CREATE INDEX `jobs_follow_up_idx` ON `jobs` (`follow_up_at`);--> statement-breakpoint
CREATE TABLE `searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`focus` text,
	`sources` text DEFAULT '[]' NOT NULL,
	`found_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL
);
