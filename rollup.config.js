import { terser } from 'rollup-plugin-terser';

let fs = require("fs");

let assert = (cond, msg) => {
    if (!cond) {
        throw new Error(msg);
    }
}


// Write a dependency file
let depfile_plugin = (depFile) => {
    return {
        name: "depfile",

        writeBundle(options, bundle) {
            let outFile = options.file;
            assert(outFile, "Missing option!");
            let info = Object.entries(bundle)[0][1];
            assert(info && !Object.entries(bundle)[1], "Unexpected bundle entry!");
            depFile ||= outFile + ".d";
            let deps = Object.keys(info.modules);
            let mf = outFile + ": " + deps.join(" ") + "\n"
                + deps.map(name => name + ":").join("\n") + "\n";
            fs.writeFileSync(depFile, mf, {mode: 0o644});
        },

    };
}


// Substitute one import for another
//
let remap_plugin = (map) => {
    let m = map.match(/(.*)=(.*)/);
    assert(m, "remap: invalid map string");
    let [_, from, to] = m;
    let fromRE = new RegExp('(.*)/' + from);

    return {
        name: "remap",

        async resolveId(source, importer, options) {
            // options.isEntry does not seem to behave as documented.
            let m = source.match(fromRE);
            if (m) {
                console.log("remap: " + from + " -> " + to);
                return m[1] + "/" + to;
            } else {
                return null;
            }
        },
    };
};


let remap = process.env.REMAP;
let minify = process.env.MINIFY;

export default {
    plugins: [
        // always write a depfile
        depfile_plugin(),
        // remap if REMAP is in the environment
        remap && remap_plugin(remap),
        minify && terser(),
    ],
   external: ['fs'],
};
