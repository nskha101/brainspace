CREATE TABLE `flow_secret` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`hosts` text NOT NULL,
	`description` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_used_at` integer,
	CONSTRAINT `fk_flow_secret_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `flow_run` ADD `run_secrets` text;--> statement-breakpoint
CREATE UNIQUE INDEX `flow_secret_name` ON `flow_secret` (`workspace_id`,`owner_id`,`name`);