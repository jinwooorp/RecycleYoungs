-- SQL avoids host bind-mount executable semantics. Unique ownership is set by
-- db-identity only after metadata + actual connection + empty-schema proof.
ALTER DATABASE recycleyoungs_team_dev SET recycleyoungs.environment = 'team-development-v1';
