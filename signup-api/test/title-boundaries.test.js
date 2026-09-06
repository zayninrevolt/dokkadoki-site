const test=require('node:test'),assert=require('node:assert/strict');
const {sameSeries,normalizeTitle}=require('../server');
test('distinct sequels do not share a vote',()=>{for(const [a,b] of [['Dragon Ball','Dragon Ball Super'],['Tokyo Ghoul','Tokyo Ghoul re']])assert.equal(sameSeries(normalizeTitle(a),normalizeTitle(b)),false,`${a} / ${b}`);});
test('Japanese-script series retain a usable normalized title',()=>{assert.equal(normalizeTitle('ワンピース'),'ワンピース');});
