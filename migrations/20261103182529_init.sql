CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `jwks` (
	`id` text PRIMARY KEY,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`alg` text,
	`crv` text
);
--> statement-breakpoint
CREATE TABLE `oauth_access_token` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`refresh_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_access_token_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_access_token_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_access_token_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_access_token_refresh_id_oauth_refresh_token_id_fk` FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_token`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_client` (
	`id` text PRIMARY KEY,
	`client_id` text NOT NULL UNIQUE,
	`client_secret` text,
	`client_discovery_id` text,
	`disabled` integer DEFAULT false,
	`skip_consent` integer,
	`enable_end_session` integer,
	`subject_type` text,
	`scopes` text,
	`client_credentials_scopes` text DEFAULT '[]',
	`user_id` text,
	`created_at` integer,
	`updated_at` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` text,
	`software_version` text,
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`backchannel_logout_uri` text,
	`backchannel_logout_session_required` integer,
	`token_endpoint_auth_method` text,
	`application_type` text,
	`jwks` text,
	`jwks_uri` text,
	`grant_types` text,
	`response_types` text,
	`require_pkce` integer,
	`dpop_bound_access_tokens` integer DEFAULT false,
	`reference_id` text,
	`metadata` text,
	CONSTRAINT `fk_oauth_client_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_client_assertion` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_client_resource` (
	`id` text PRIMARY KEY,
	`client_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`metadata` text,
	`created_at` integer,
	CONSTRAINT `fk_oauth_client_resource_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_client_resource_resource_id_oauth_resource_identifier_fk` FOREIGN KEY (`resource_id`) REFERENCES `oauth_resource`(`identifier`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_consent` (
	`id` text PRIMARY KEY,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_oauth_consent_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_consent_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_refresh_token` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked` integer,
	`rotated_at` integer,
	`rotation_replay_response` text,
	`rotation_replay_expires_at` integer,
	`auth_time` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_refresh_token_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_refresh_token_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_refresh_token_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_resource` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`access_token_ttl` integer,
	`refresh_token_ttl` integer,
	`signing_algorithm` text,
	`signing_key_id` text,
	`allowed_scopes` text,
	`custom_claims` text,
	`dpop_bound_access_tokens_required` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer,
	`policy_version` integer DEFAULT 1,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`default_workspace_id` text
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`via` text NOT NULL,
	`client_name` text,
	`action` text NOT NULL,
	`node_id` text,
	`drive_id` text,
	`path` text,
	`details` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_key` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL UNIQUE,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_api_key_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_api_key_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `connection` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`preset_id` text,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`auth_type` text NOT NULL,
	`credential_mode` text DEFAULT 'shared' NOT NULL,
	`oauth_client` text,
	`oauth_scope` text,
	`min_role` text DEFAULT 'viewer' NOT NULL,
	`access_mode` text DEFAULT 'all' NOT NULL,
	`expose_tools` integer DEFAULT true NOT NULL,
	`tool_allowlist` text,
	`read_only_tools` text,
	`instructions` text,
	`tools_cache` text,
	`tools_cached_at` integer,
	`status` text DEFAULT 'needs_auth' NOT NULL,
	`status_message` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_connection_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `connection_access` (
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	CONSTRAINT `connection_access_pk` PRIMARY KEY(`connection_id`, `user_id`),
	CONSTRAINT `fk_connection_access_connection_id_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `connection`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_connection_access_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `connection_credential` (
	`connection_id` text NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`data` text NOT NULL,
	`oauth_state` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `connection_credential_pk` PRIMARY KEY(`connection_id`, `user_id`),
	CONSTRAINT `fk_connection_credential_connection_id_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `connection`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`email` text,
	`role` text NOT NULL,
	`token` text NOT NULL UNIQUE,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_invitation_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_member_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `node` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`drive_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text,
	`size` integer DEFAULT 0 NOT NULL,
	`content` text,
	`r2_key` text,
	`version` integer DEFAULT 0 NOT NULL,
	`description` text,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	CONSTRAINT `fk_node_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `node_version` (
	`id` text PRIMARY KEY,
	`node_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text,
	`r2_key` text,
	`size` integer DEFAULT 0 NOT NULL,
	`hash` text,
	`message` text,
	`author_id` text NOT NULL,
	`via` text NOT NULL,
	`client_name` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_node_version_node_id_node_id_fk` FOREIGN KEY (`node_id`) REFERENCES `node`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`description` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_clientId_idx` ON `oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_sessionId_idx` ON `oauth_access_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_userId_idx` ON `oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_authorizationCodeId_idx` ON `oauth_access_token` (`authorization_code_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_refreshId_idx` ON `oauth_access_token` (`refresh_id`);--> statement-breakpoint
CREATE INDEX `oauthClient_userId_idx` ON `oauth_client` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauthClientResource_clientId_resourceId_uidx` ON `oauth_client_resource` (`client_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_clientId_idx` ON `oauth_client_resource` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_resourceId_idx` ON `oauth_client_resource` (`resource_id`);--> statement-breakpoint
CREATE INDEX `oauthConsent_clientId_idx` ON `oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthConsent_userId_idx` ON `oauth_consent` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_clientId_idx` ON `oauth_refresh_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_sessionId_idx` ON `oauth_refresh_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_userId_idx` ON `oauth_refresh_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_authorizationCodeId_idx` ON `oauth_refresh_token` (`authorization_code_id`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `activity_ws_time` ON `activity` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `api_key_user` ON `api_key` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `connection_slug` ON `connection` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `connection_credential_state` ON `connection_credential` (`oauth_state`);--> statement-breakpoint
CREATE INDEX `invitation_ws` ON `invitation` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_ws_user` ON `member` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `member_user` ON `member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `node_live_path` ON `node` (`workspace_id`,`drive_id`,`path`) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX `node_parent` ON `node` (`workspace_id`,`drive_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `node_updated` ON `node` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `node_version_unique` ON `node_version` (`node_id`,`version`);