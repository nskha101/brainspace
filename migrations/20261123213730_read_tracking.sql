CREATE TABLE `node_read` (
	`node_id` text NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`workspace_id` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`via` text NOT NULL,
	`client_name` text,
	`first_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `node_read_pk` PRIMARY KEY(`node_id`, `user_id`, `source`),
	CONSTRAINT `fk_node_read_node_id_node_id_fk` FOREIGN KEY (`node_id`) REFERENCES `node`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `node` ADD `read_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `node` ADD `reader_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `node` ADD `read_at` integer;--> statement-breakpoint
ALTER TABLE `node` ADD `read_by` text;--> statement-breakpoint
ALTER TABLE `node` ADD `flow_read_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `node` ADD `flow_read_at` integer;