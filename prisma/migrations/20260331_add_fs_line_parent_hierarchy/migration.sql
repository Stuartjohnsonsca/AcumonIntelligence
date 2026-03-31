-- Add parent hierarchy to FS Lines (note_item → parent fs_line_item)
ALTER TABLE "methodology_fs_lines" ADD COLUMN "parent_fs_line_id" TEXT;
CREATE INDEX "methodology_fs_lines_parent_fs_line_id_idx" ON "methodology_fs_lines"("parent_fs_line_id");
ALTER TABLE "methodology_fs_lines" ADD CONSTRAINT "methodology_fs_lines_parent_fs_line_id_fkey" FOREIGN KEY ("parent_fs_line_id") REFERENCES "methodology_fs_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
