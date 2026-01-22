Please read the analytics feature plan, which is now fully implemented, and create a next step in a new plan for Sankey Diagrams. Again, consider how we will build the visualizations, and allow users to click through certain sections of the diagram. Unlike with the Pie Charts flow, Sankey Diagrams show the full breakdown so please have the main page show the full statement breakdown of all categories. Do not include vendor breakdowns in the Statement view.

A user can still click into a specific node of the diagram to zoom in on that category. In this case, vendors should be included in the breadkdowns. 

The sankey diagram should be horizontal across the screen, and if the user clicks on a node, a list of the breadowns with their numbers should appear in a table below the diagram. Above that table should be a button to "Drill down". That button should link to the page that shows the sankey diagram of with that node at the root. This table should reuse the existing table component, and the same with all buttons. 

Make the sankey diagram beautiful and have hovering over a node display its name if its not already visible. 


--- 

Support multiple statement formats

Now, we need to expand the types of File Formats we can import. This part should be flexible and extensible. 

We will want to be able to import different file formats for the same bank but allow the user to label the bank and account they are importing from. We already have the Account name field on the import page, so we can use that. But we'll need to add a Bank field as well. 

I'm imagining that we'll have a nested map of institution names to account types to CSV formats. So, for example, Bank of America might have a Credit Card account statement format that uses a different CSV format than a Checking account statement format. Don't take this data decision as authoritative. Feel free to propose a better solution. We will need to map each CSV format to our existing Data Schema. Each CSV format may also need some massaging, such as removing the first N lines or converting TSV to CSV, or soemthing. Please account for this. 

When the user goes to import a statement, they should be able to select the institution from our hardcoded list of supported institutions, and then select the Account Type. Here is where it is tricky: We want there to be an Account grouping so that a user can organize their statements from a specific account at a specific institution. But we also want to allow users to have more than one of the same account/institution pair. So, we'll need Account Type, Institution, and Account Name (determined by the user). 

This seems to call for a separate Accounts table to which a statement belongs. 

A critical concern here is that uploading a statement should be extremely easy and require minimal manual text entry or form entries. One way to achieve this is to have a dropdown for existing Accounts (which already have the Institution and Account Type set). 

First new CSV Schema: Bank of America (Checking)

Date,Description,Amount,Running Bal.

--- 
Now that we have the new CSV format, we will start having longer vendor/counterparty names. I think this will require us to upgrade from LCP for grouping to Levenshtein distance so that we can evaluate mutliple substring matches between two counterparty names, since transaction descriptions often look like "UBER ID:12341234 UBER SDHFJKSDH". Please plan this upgrade very briefly. It's a small feature so it shouldn't require a large planning doc. Include ZERO code examples. But do include some benchmarks or illustrations of the advantages of Levenshtein vs LCP. 

--- 

Here is a CSV format from my Capital One Savings Account: Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance

Here is a sample row: 7443,Monthly Interest Paid,12/31/25,Credit,58.24,20539.66

Please plan to integrate this Institution (Capital One) and Account Type (Savings) into our system so that users can upload this statement type. 

While you do this, please create a generic Claude SKILL for integrating new CSV formats given a sample file, institution name, and account type. 

--- 

Please take a pass through the codebase backend and see if there are opportunities to make the code DRYer, more modular and more composable. DO NOT CHANGE ANY LOGIC/BEHAVIOR. DO NOT EDIT ANY TESTS. 

---

Please take a pass through all UI components and pages and see if there are opportunities to make the code DRYer, more modular and more composable. DO NOT CHANGE ANY LOGIC/BEHAVIOR. DO NOT EDIT ANY TESTS. DO NOT CHANGE any backend logic code. 
Please use any and all skills in the impeccable design plugin to help you. 

--- 

custom import builder

