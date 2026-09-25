-- A finance or manager bill revision can increase a line. QC only ever
-- reduced one, so this value never existed.
ALTER TYPE "LineChangeType" ADD VALUE IF NOT EXISTS 'INCREASED' AFTER 'REDUCED';
