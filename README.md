1. CSV Import Tool

2. Parse to SQLite queries

3. SQLite Schema: 

- Statement
    - ID
    - Period
    - Account

- Vendors
    - ID
    - Name
    - Address
    - Category

- Transactions
    - ID
    - ReferenceNumber
    - Date
    - StatementID
    - VendorID
    - Amount

4. Confirmation Page

5. List Statements Page

6. View Statement Page (should resemble the Confirmation Page)

6. Add Category Schema

Category: 
- ID
- Name
- Color
- Description
- ParentCategoryID

Default Categories: 

Income
    - Salary / Wages
    - Benefits
    - Other

Expenses 
  - Housing
    - Utilities
    - Rent
  - Food & Drink
    - Groceries
    - Restaurants
    - Coffee Shops
    - Bars
    - Delivery
  - Transportation
    - Gas
    - Public Transit
    - Rideshare
    - Parking
    - Airfare
    - Vehicle Insurance
    - Vehicle Maintenance
    - Other
  - Entertainment
  - Shopping
    - Clothing
    - Shoes
    - Accessories
    - Electronics
    - Home Goods
    - Other
  - Health
    - Doctor
    - Dentist
    - Pharmacy
    - Gym
    - Other

- Transfers
    - Tax Returns
    - Other

I want to build a Categorization Rules feature that allows users to build rules that help ingest and interpret Statements. Please plan this feature out in detail in a new doc in the docs folder called `CATEGORIZATION_RULES_PLAN.md`.

There may be several types of rules, and thus there should be a hardcoded order in which types of rules are applied. Additionally, within a type of rule, there may be multiple rules that are applied in a specific, user-editable order.

I believe this calls for a self-contained Engine that applies all of these rules and returns new vendor-to-category mappings.
 
The first type of rule is a regex mapping, which takes a list of regex-to-category mappings and applies them in an editable but deterministic order. 

The regex mappings should be in the DB and there should be a page where users can edit, create, reorder, and delete them.

Please select a Regex library/logic that is simple to implement but also easy to understand and use. Ideally, features like * is supported as they work in bash rather than regex where .* is needed instead. 

Do not overengineer the solution. Keep it simple, composable, and easy to understand and use.