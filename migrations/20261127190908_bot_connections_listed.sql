-- A bot used to reach every connection its owner could when it listed none. Now it has only the
-- ones it lists, so bots that listed none get today's reach written down and keep working as before.
-- The workspace's own bot acts as whoever asks, so it gets every connection in the workspace.
UPDATE `bot` SET `connections` = (
	SELECT json_group_array(`slug`) FROM (
		SELECT c.`slug` FROM `connection` c
		LEFT JOIN `member` m ON m.`workspace_id` = `bot`.`workspace_id` AND m.`user_id` = `bot`.`owner_id`
		WHERE c.`workspace_id` = `bot`.`workspace_id`
			AND (
				`bot`.`kind` = 'workspace'
				OR (
					(CASE m.`role` WHEN 'admin' THEN 2 WHEN 'member' THEN 1 WHEN 'viewer' THEN 0 ELSE -1 END)
						>= (CASE c.`min_role` WHEN 'admin' THEN 2 WHEN 'member' THEN 1 ELSE 0 END)
					AND (
						c.`access_mode` <> 'restricted'
						OR m.`role` = 'admin'
						OR EXISTS (SELECT 1 FROM `connection_access` a WHERE a.`connection_id` = c.`id` AND a.`user_id` = `bot`.`owner_id`)
					)
				)
			)
		ORDER BY c.`slug`
	)
) WHERE `connections` IS NULL;
