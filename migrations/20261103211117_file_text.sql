CREATE TABLE `node_text` (
	`node_id` text PRIMARY KEY,
	`version` integer NOT NULL,
	`markdown` text NOT NULL,
	`r2_key` text,
	`chars` integer NOT NULL,
	`pages` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_node_text_node_id_node_id_fk` FOREIGN KEY (`node_id`) REFERENCES `node`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `node` ADD `text_status` text;--> statement-breakpoint
ALTER TABLE `node` ADD `text_error` text;--> statement-breakpoint
ALTER TABLE `node` ADD `text_chars` integer;