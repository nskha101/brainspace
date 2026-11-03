ALTER TABLE `workspace` ADD `auto_join_domain` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `auto_join_role` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
CREATE INDEX `workspace_auto_join` ON `workspace` (`auto_join_domain`);