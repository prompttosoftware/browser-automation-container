const pidusage = require('pidusage');

function checkMemory() {
    // Define a threshold in bytes (e.g., 500 MB)
    const THRESHOLD = 300 * 1024 * 1024; 
    
    pidusage(process.pid, (err, stats) => {
    if (err) {
        console.error('Error fetching memory usage:', err);
        return;
    }
    // stats.memory is in bytes
    console.log(`Current Memory Usage: ${(stats.memory / (1024 * 1024)).toFixed(2)} MB`);
    
    if (stats.memory > THRESHOLD) {
        console.error('Memory usage exceeded threshold, exiting container for restart...');
        setTimeout(() => process.exit(1), 500);
    }
    });
}

module.exports = {
    checkMemory
};
