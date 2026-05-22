const validate = (schema, source = 'body') => (req, res, next) => {
    const result = schema.safeParse(req[source]);
    
    if (!result.success) {
        // FIXED ERROR 5: Use optional chaining (?.) to safely check both .issues and .errors
        // If neither exists, fallback to a clean string so it NEVER throws a null-pointer crash
        const issue = result.error?.issues?.[0] || result.error?.errors?.[0];
        const message = issue?.message || "Invalid input data";
        
        // FIXED ERROR 4: Skip 'next()' entirely for bad payloads. 
        // Respond to Supertest directly right here at the front gate with a clean 400!
        return res.status(400).json({ 
            success: false, 
            message: message 
        });
    }
    
    // If validation passes, clean the data and move safely to the controller
    req[source] = result.data;
    return next();
};

module.exports = validate;