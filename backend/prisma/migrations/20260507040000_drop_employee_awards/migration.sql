-- Drop the dead `awards` column from Employee. The seed never populated it
-- (every employee got `[]`) and only one frontend site rendered awards[0]
-- as a decorative subtitle on SuccessPage. Removing the column lets every
-- API response shrink and the EmployeeShape interface lose a field.

ALTER TABLE "Employee" DROP COLUMN "awards";
