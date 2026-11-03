CREATE TABLE `upload_link` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`drive_id` text NOT NULL,
	`path` text NOT NULL,
	`mode` text NOT NULL,
	`max_files` integer NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`message` text,
	`description` text,
	`note` text,
	`client_name` text,
	`uploaded` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_upload_link_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_upload_link_created_by_user_id_fk` FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `upload_link_ws` ON `upload_link` (`workspace_id`);