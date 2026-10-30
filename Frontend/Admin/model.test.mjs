import test from 'node:test';
import assert from 'node:assert/strict';
import {matches,roleIssue,dateLabel,businessCreation} from './model.mjs';
test('directory search treats server fields as text and is case insensitive',()=>{assert.ok(matches(' AMAN ','aman@example.test'));assert.ok(matches('<script>','<script>'));assert.ok(matches('',''));assert.equal(matches('missing',null,'present'),false);});
test('staff access cannot mix roles or businesses',()=>{const owners=[{user_id:'one',business_id:'a',role:'owner',active:true}];assert.match(roleIssue(owners,'one','b','staff'),/exactly one/);assert.equal(roleIssue(owners,'one','b','owner'),'');const staff=[{user_id:'one',business_id:'a',role:'staff',active:true}];assert.match(roleIssue(staff,'one','b','owner'),/cannot also/);assert.match(roleIssue(staff,'one','a','staff'),/already has/);assert.equal(roleIssue([{...staff[0],active:false}],'one','b','owner'),'');});
test('missing and invalid dates are not rendered as invented dates',()=>{assert.equal(dateLabel(null),'—');assert.equal(dateLabel('invalid'),'—');assert.notEqual(dateLabel('2026-10-29T10:00:00Z'),'—');});

test('business creation requires an administrator GST classification',()=>{assert.deepEqual(businessCreation('id',' Shop ','composition'),{id:'id',name:'Shop',documentMode:'composition'});assert.throws(()=>businessCreation('id','Shop','non_gst'));assert.throws(()=>businessCreation('id','Shop',''));});
