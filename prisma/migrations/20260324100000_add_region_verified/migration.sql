-- AddRegionVerified
-- Track which companies have been verified for region accuracy.

ALTER TABLE "companies" ADD COLUMN "region_verified" BOOLEAN NOT NULL DEFAULT false;
