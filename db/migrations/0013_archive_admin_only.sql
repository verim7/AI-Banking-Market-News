-- The Archive tab is for administrators only (29 Sep 2026), like the Review
-- Queue. Colleagues read the Market Lens and Trends & Summary. The role
-- descriptions shown on the Admin tab said Viewers could open the archive, so
-- they are corrected to match. No permission changes: the Lens and the
-- Archive read the same articles API, and the tab is hidden in the app.
UPDATE roles SET description = 'Read-only access to the Market Lens and Trends & Summary'
  WHERE id = 'role_viewer';
UPDATE roles SET description = 'Reads the Market Lens and Trends & Summary, triages and exports'
  WHERE id = 'role_analyst';
