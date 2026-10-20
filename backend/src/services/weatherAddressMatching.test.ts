import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weatherAddressesMatch } from './weatherAddressMatching';

test('same street with city, state and ZIP in one field', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane', '2354 Hazelwood Lane Clearwater Florida 33763'), true);
});

test('same street with commas and abbreviated suffix', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane', '2354 Hazelwood Ln, Clearwater, FL 33763'), true);
});

test('same street with full address on both sides', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane, Clearwater, FL 33763', '2354 Hazelwood Ln Clearwater Florida 33763'), true);
});

test('different house numbers must not match', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane', '2356 Hazelwood Lane Clearwater Florida 33763'), false);
});

test('different street names must not match', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane', '2354 Oakwood Lane Clearwater Florida 33763'), false);
});

test('street names that merely share a prefix must not match', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane', '2354 Hazelwood Lane Extension Clearwater Florida 33763'), false);
});


test('conflicting cities must not match', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane, Clearwater, FL', '2354 Hazelwood Lane, Tampa, FL'), false);
});

test('conflicting ZIP codes must not match', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane, Clearwater, FL 33763', '2354 Hazelwood Lane, Clearwater, FL 33602'), false);
});

test('street-only input may match a complete stored address', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane', '2354 Hazelwood Lane Clearwater Florida 33763'), true);
});

test('different states must not match', () => {
  assert.equal(weatherAddressesMatch('2354 Hazelwood Lane, Clearwater, FL', '2354 Hazelwood Lane, Clearwater, GA'), false);
});
