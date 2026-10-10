import test from 'node:test';
import assert from 'node:assert/strict';
import {wholeTextLines} from '../www/course-card-fit.js';

test('文本高度预算只接受完整行，不用半行或向上取整凑标题',()=>{
  assert.equal(wholeTextLines(33,17.4,4),1);
  assert.equal(wholeTextLines(34.8,17.4,4),2);
  assert.equal(wholeTextLines(45,17.4,4),2);
  assert.equal(wholeTextLines(8,13,2),0);
  assert.equal(wholeTextLines(100,13,2),2);
  assert.equal(wholeTextLines(-2,13,2),0);
});
