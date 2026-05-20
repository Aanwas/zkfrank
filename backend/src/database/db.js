import sqlite3 from 'sqlite3';

// connecting to the database file (it will be created automatically if it does not exist)
const db = new sqlite3.Database('./proofs.db');

// initialization function, creates a table if we run the code for the first time
export function initDatabase(){
    return new Promise((resolve, reject) => {
        const createTableQuery = 
                    `CREATE TABLE IF NOT EXISTS validations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        proof_hash TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )`

            db.run(createTableQuery, (err) => {
                if(err){
                    console.error("Table creation error:", err);
                    reject(err)
                }else{
                    console.log("The SQLite table is ready.");
                    resolve();
                }
            });
    });
}

// save proof to the database using Promises for async/await support
export function saveProofToDatabase(nullifier) {
    return new Promise((resolve, reject) => {
        
        // сheck for duplicates 
        db.get("SELECT id FROM validations WHERE proof_hash = ?", [nullifier], (err, row) => {
            if (err) {
                console.error("Error while checking for duplicates:", err.message);
                reject(err); // reject the promise if a database error occurs
                return;
            }
            
            if (row) {
                console.log(`Warning! This proof already exists (ID: ${row.id})`);
                resolve(false); // resolve successfully, but return 'false' if duplicate found
            } else {
                console.log("New unique proof! Saving to database...");
                
                // insert the new proof
                db.run("INSERT INTO validations (proof_hash) VALUES (?)", [nullifier], (insertErr) => {
                    if (insertErr) {
                        console.error("Error during saving:", insertErr.message);
                        reject(insertErr); // reject if insertion fails
                    } else {
                        console.log("Saved successfully!");
                        resolve(true); // resolve and return 'true' (saved successfully)
                    }
                });
            }
        });

    });
}