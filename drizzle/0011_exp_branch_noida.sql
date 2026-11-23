-- One time: Exp entries with a blank Branch get the default Branch "Noida" (anything already filled is left as it is).
UPDATE "exp_entries" SET "branch" = 'Noida' WHERE coalesce(trim("branch"), '') = '';
