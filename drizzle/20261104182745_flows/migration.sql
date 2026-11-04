CREATE TABLE `flow` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`drive_id` text NOT NULL,
	`folder_node_id` text NOT NULL UNIQUE,
	`folder_path` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`manifest` text,
	`manifest_node_id` text,
	`manifest_version` integer,
	`code_node_id` text,
	`code_version` integer,
	`code_hash` text,
	`diagram` text,
	`scope_hash` text,
	`status` text NOT NULL,
	`error` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_flow_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `flow_run` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`trigger_id` text,
	`mode` text NOT NULL,
	`flow_name` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_version` integer,
	`manifest_version` integer,
	`scope` text NOT NULL,
	`model` text,
	`run_as_user_id` text NOT NULL,
	`started_by` text NOT NULL,
	`inputs` text NOT NULL,
	`deliver` text NOT NULL,
	`status` text NOT NULL,
	`outputs` text,
	`outputs_key` text,
	`deliveries` text,
	`captured` text,
	`pending_approval` text,
	`error` text,
	`ai_calls` integer DEFAULT 0 NOT NULL,
	`ai_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	CONSTRAINT `fk_flow_run_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flow_run_flow_id_flow_id_fk` FOREIGN KEY (`flow_id`) REFERENCES `flow`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `flow_run_log` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`at` integer NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`hash` text NOT NULL,
	CONSTRAINT `fk_flow_run_log_run_id_flow_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `flow_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `flow_run_step` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`until` integer,
	`error` text,
	`preview` text,
	CONSTRAINT `fk_flow_run_step_run_id_flow_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `flow_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `flow_trigger` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`cron` text,
	`timezone` text,
	`next_run_at` integer,
	`inputs` text NOT NULL,
	`deliver` text NOT NULL,
	`run_as_user_id` text NOT NULL,
	`approved_scope_hash` text NOT NULL,
	`approved_scope` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`paused_reason` text,
	`webhook_token_hash` text UNIQUE,
	`last_run_id` text,
	`last_status` text,
	`last_run_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_flow_trigger_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flow_trigger_flow_id_flow_id_fk` FOREIGN KEY (`flow_id`) REFERENCES `flow`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_flow_trigger_run_as_user_id_user_id_fk` FOREIGN KEY (`run_as_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `workspace` ADD `ai_gateway_key` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `ai_model` text;--> statement-breakpoint
CREATE INDEX `flow_ws` ON `flow` (`workspace_id`,`drive_id`);--> statement-breakpoint
CREATE INDEX `flow_run_ws` ON `flow_run` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `flow_run_flow` ON `flow_run` (`flow_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `flow_run_status` ON `flow_run` (`workspace_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `flow_run_log_hash` ON `flow_run_log` (`run_id`,`hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `flow_run_step_name` ON `flow_run_step` (`run_id`,`name`);--> statement-breakpoint
CREATE INDEX `flow_trigger_flow` ON `flow_trigger` (`flow_id`);--> statement-breakpoint
CREATE INDEX `flow_trigger_due` ON `flow_trigger` (`enabled`,`next_run_at`);