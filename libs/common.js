const path = require('path');
const tmpDir = process.cwd()+'/tmp/';

function getCidrFile(cidr) {
    return path.resolve(tmpDir + cidr.replace(/\//, '-') + '.json');
}

module.exports = {
    getCidrFile
};

