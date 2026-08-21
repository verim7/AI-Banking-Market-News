INSERT OR REPLACE INTO sources (id,name,url,kind,publisher_kind,region_hint,enabled) VALUES
 ('mck','McKinsey Financial Services','https://example.com/mck','rss','consultancy',NULL,1),
 ('finma','FINMA','https://example.com/finma','rss','regulator','switzerland',1);

INSERT OR REPLACE INTO articles (id,url_canonical,url_original,title,summary,search_text,source_id,source_name,publisher_kind,published_at,enriched_by) VALUES
 ('f1','https://example.com/a1','https://example.com/a1','Swiss private banks deploy generative AI copilots','A study of relationship manager copilots at wealth managers.','swiss private banks deploy generative ai copilots relationship manager','mck','McKinsey Financial Services','consultancy','2026-08-18T09:00:00Z','rules'),
 ('f2','https://example.com/a2','https://example.com/a2','German retail banks cut AML false positives with machine learning','The bank has deployed machine learning models for transaction monitoring across all retail customers, cutting false positives after a two-year pilot.','german retail banks aml fraud machine learning','mck','McKinsey Financial Services','consultancy','2026-08-17T09:00:00Z','rules'),
 ('f3','https://example.com/a3','https://example.com/a3','MAS sets out AI governance expectations for Singapore banks','Supervisory guidance on model risk.','mas singapore ai governance model risk banks','finma','FINMA','regulator','2026-08-16T09:00:00Z','rules'),
 ('f4','https://example.com/a4','https://example.com/a4','US bank pilots a customer service chatbot','A retail chatbot pilot.','us bank chatbot customer service retail','mck','McKinsey Financial Services','media','2026-08-15T09:00:00Z','rules');

-- ai_intensity and maturity are what the Market Lens analysis table reads.
INSERT OR REPLACE INTO article_scores
  (article_id,relevance_score,rule_hits,ai_intensity,maturity,maturity_evidence) VALUES
 ('f1',82.0,'[{"rule":"ai_term","term":"generative ai","weight":10}]',89,'research','study'),
 ('f2',71.0,'[{"rule":"ai_term","term":"machine learning","weight":10}]',84,'in_production','deployed across'),
 ('f3',64.0,'[{"rule":"ai_term","term":"ai","weight":10}]',72,'unknown',NULL),
 ('f4',41.0,'[{"rule":"ai_term","term":"chatbot","weight":10}]',58,'pilot','pilot');

INSERT OR REPLACE INTO article_tags (article_id,dimension,value,confidence) VALUES
 ('f1','ai_type','generative_ai',0.9),
 ('f1','l1_process','advisory_sales',0.8),
 ('f2','ai_type','machine_learning',0.9),
 ('f2','l1_process','financial_crime',0.9),
 ('f3','ai_type','machine_learning',0.6),
 ('f3','l1_process','compliance_regulatory',0.8),
 ('f4','ai_type','generative_ai',0.7),
 ('f4','l1_process','client_service',0.9);

INSERT OR REPLACE INTO article_tags (article_id,dimension,value,confidence) VALUES
 ('f1','region','switzerland',0.9),('f1','banking_area','private_wealth',0.9),('f1','bank_category','pwbm',0.8),('f1','use_case','advisory_copilot',0.9),
 ('f2','region','germany_dach',0.9),('f2','banking_area','retail_banking',0.9),('f2','bank_category','retail_bank',0.8),('f2','use_case','fraud_aml',0.9),
 ('f3','region','singapore_apac',0.9),('f3','banking_area','risk_compliance',0.9),('f3','bank_category','central_bank_regulator',0.8),('f3','use_case','regtech',0.9),
 ('f4','region','usa_north_america',0.9),('f4','banking_area','retail_banking',0.9),('f4','bank_category','retail_bank',0.8),('f4','use_case','customer_service',0.9);

INSERT OR REPLACE INTO ingest_runs (id,started_at,finished_at,status,items_fetched,items_new,sources_ok,sources_failed,detail)
VALUES ('run1','2026-08-20T04:20:00Z','2026-08-20T04:22:00Z','ok',4,4,2,0,'{"sources":[]}');

-- A role restricted to Switzerland, and an analyst who holds only that role.
-- The scope test asserts this user sees exactly one of the four articles.
INSERT OR REPLACE INTO roles (id,name,description,built_in)
  VALUES ('role_ch','Switzerland Analyst','Sees Swiss coverage only',0);
INSERT OR REPLACE INTO role_permissions (role_id,permission_key) VALUES
  ('role_ch','articles.read'),('role_ch','favorites.write'),
  ('role_ch','hil.review'),('role_ch','hil.export');
INSERT OR REPLACE INTO role_scopes (role_id,dimension,value)
  VALUES ('role_ch','region','switzerland');

-- Two accounts the smoke test signs in as. These hashes are for throwaway
-- local passwords and exist only so the e2e run is reproducible; the seed for
-- a real deployment never contains a user (see db/seed.sql).
--   admin@example.com / smoke-test-password-1   (Administrator, sees everything)
--   ch@example.com    / another-long-password-2 (Switzerland Analyst, scoped)
-- Hashes are PBKDF2-SHA256 at the iteration count in packages/worker/src/auth.ts.
-- Change ITERATIONS and these stop verifying: regenerate with hashPassword(),
-- reusing the salts below so only the hash column moves.
INSERT OR REPLACE INTO users (id,email,display_name,password_hash,password_salt,active) VALUES
 ('user_e2e_admin','admin@example.com','E2E Admin','0494d5af12799870b8562c10885e95e9eea54c1feda1ada492db4eb64493cc1c','aac76f81fe61e8d1403a2caf270f7a7c',1),
 ('user_e2e_ch','ch@example.com','CH Analyst','7f2cfd2ee78205a90532db2835fa1a421202fecdec4b36e600d7c29523f96197','bf21dd4e28c1fb98b20928f379e6d9c6',1);
INSERT OR REPLACE INTO user_roles (user_id,role_id) VALUES
 ('user_e2e_admin','role_admin'),
 ('user_e2e_ch','role_ch');

-- Spread across the last year so the 12-month Lens has a real trend to draw.
INSERT OR REPLACE INTO articles (id,url_canonical,url_original,title,summary,search_text,source_id,source_name,publisher_kind,published_at,enriched_by) VALUES
 ('f5','https://example.com/f5','https://example.com/f5','Barclays deploys an agentic AI assistant across operations','Autonomous AI agents now handle exception triage in the back office, and the tooling is live for 4,000 operations staff.','barclays deploys an agentic ai assistant across operations autonomous agents now live in back office processing.','mck','McKinsey Financial Services','bank','2026-06-19T09:00:00Z','rules'),
 ('f6','https://example.com/f6','https://example.com/f6','OCBC trials generative AI for credit memo drafting','The lender is piloting a large language model that drafts credit memos for underwriters, with a human reviewing every output.','ocbc trials generative ai for credit memo drafting a pilot of llm drafting in underwriting.','mck','McKinsey Financial Services','bank','2026-04-20T09:00:00Z','rules'),
 ('f7','https://example.com/f7','https://example.com/f7','BaFin publishes guidance on machine learning model risk','Supervisory expectations for AI models at German banks.','bafin publishes guidance on machine learning model risk supervisory expectations for ai models at german banks.','mck','McKinsey Financial Services','regulator','2026-02-19T09:00:00Z','rules'),
 ('f8','https://example.com/f8','https://example.com/f8','Deloitte survey: generative AI adoption across European banks','A study of GenAI programmes at 120 institutions.','deloitte survey: generative ai adoption across european banks a study of genai programmes at 120 institutions.','mck','McKinsey Financial Services','consultancy','2025-12-21T09:00:00Z','rules'),
 ('f9','https://example.com/f9','https://example.com/f9','HSBC scales machine learning fraud detection bank-wide','Machine learning fraud scoring was rolled out to all retail customers bank-wide following a successful pilot last year.','hsbc scales machine learning fraud detection bank-wide rolled out to all retail customers after a pilot.','mck','McKinsey Financial Services','bank','2025-10-22T09:00:00Z','rules'),
 ('f10','https://example.com/f10','https://example.com/f10','UBS pilots an AI copilot for client advisors','The bank is testing a generative AI copilot that prepares client meeting briefings for its relationship managers.','ubs pilots an ai copilot for client advisors testing generative ai in wealth advisory.','mck','McKinsey Financial Services','bank','2025-08-23T09:00:00Z','rules');

INSERT OR REPLACE INTO article_scores (article_id,relevance_score,rule_hits,ai_intensity,maturity,maturity_evidence) VALUES
 ('f5',71.0,'[]',76,'in_production','now live'),
 ('f6',76.0,'[]',81,'pilot','pilot'),
 ('f7',64.0,'[]',69,'unknown',NULL),
 ('f8',68.0,'[]',73,'research','study'),
 ('f9',82.0,'[]',87,'in_production','bank-wide'),
 ('f10',79.0,'[]',84,'pilot','testing');

INSERT OR REPLACE INTO article_tags (article_id,dimension,value,confidence) VALUES
 ('f5','ai_type','agentic_ai',0.9),
 ('f5','l1_process','operations_processing',0.9),
 ('f5','region','uk',0.9),
 ('f6','ai_type','generative_ai',0.9),
 ('f6','l1_process','lending_credit',0.9),
 ('f6','region','singapore_apac',0.9),
 ('f7','ai_type','machine_learning',0.9),
 ('f7','l1_process','compliance_regulatory',0.9),
 ('f7','region','germany_dach',0.9),
 ('f8','ai_type','generative_ai',0.9),
 ('f8','l1_process','technology_data',0.9),
 ('f8','region','eu',0.9),
 ('f9','ai_type','machine_learning',0.9),
 ('f9','l1_process','financial_crime',0.9),
 ('f9','region','uk',0.9),
 ('f10','ai_type','generative_ai',0.9),
 ('f10','l1_process','advisory_sales',0.9),
 ('f10','region','switzerland',0.9);

-- Quoted use-case sentences, produced by the classifier from the summaries
-- above. Regenerate them if those summaries change.
WITH ev(article_id, txt) AS (VALUES
 ('f1', 'A study of relationship manager copilots at wealth managers.'),
 ('f2', 'The bank has deployed machine learning models for transaction monitoring across all retail customers, cutting false positives after a two-year pilot.'),
 ('f3', NULL),
 ('f4', NULL),
 ('f5', 'Autonomous AI agents now handle exception triage in the back office, and the tooling is live for 4,000 operations staff.'),
 ('f6', 'The lender is piloting a large language model that drafts credit memos for underwriters, with a human reviewing every output.'),
 ('f7', 'Supervisory expectations for AI models at German banks.'),
 ('f8', NULL),
 ('f9', 'Machine learning fraud scoring was rolled out to all retail customers bank-wide following a successful pilot last year.'),
 ('f10', 'The bank is testing a generative AI copilot that prepares client meeting briefings for its relationship managers.')
)
UPDATE article_scores SET use_case_evidence = (SELECT txt FROM ev WHERE ev.article_id = article_scores.article_id)
WHERE article_id IN (SELECT article_id FROM ev);

-- Body text for one article, so the drill-down is exercised against something
-- to read rather than only against its empty state.
--
-- Attached to f2 because f2 is the fixture's production deployment, and the
-- prose below describes one. Putting a live-rollout narrative on f1 — which
-- this file defines as a *study* — would have made the fixture contradict
-- itself, and a test written against a self-contradicting fixture proves
-- nothing about the product.
--
-- Written as real prose because the summariser quotes it verbatim: a test that
-- asserts the summary is a substring of the source needs a genuine source.
UPDATE articles SET excerpt =
  'Several German retail banks have deployed machine learning models for '
  || 'transaction monitoring across all retail customers, with Commerzbank and '
  || 'a group of savings banks confirming the systems are now running in '
  || 'production. The rollout followed a two-year pilot and has cut false '
  || 'positives in anti-money-laundering alerting by more than half. Compliance '
  || 'teams that once triaged thousands of alerts a week now review a fraction '
  || 'of that number, and the banks say investigators spend their time on cases '
  || 'that turn out to matter. BaFin has said it expects institutions to '
  || 'document how such models reach their conclusions. Shares in the sector '
  || 'were little changed on the news.'
WHERE id = 'f2';

UPDATE article_scores SET summary_extract =
  'Several German retail banks have deployed machine learning models for '
  || 'transaction monitoring across all retail customers, with Commerzbank and '
  || 'a group of savings banks confirming the systems are now running in '
  || 'production. The rollout followed a two-year pilot and has cut false '
  || 'positives in anti-money-laundering alerting by more than half.'
WHERE article_id = 'f2';
