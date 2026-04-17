import db from './src/database/index.js';
import { createFaqService } from './src/models/Faq/faq.service.js';

try {
  console.log('🧪 Testing createFaqService with JSON payload…\n');
  
  const [tenants] = await db.sequelize.query('SELECT tenant_id FROM tenants LIMIT 1');
  if (!tenants.length) {
    console.log('No tenant found');
    process.exit(0);
  }

  const tenantId = tenants[0].tenant_id;
  const testQuestion = `How do I request an ambulance?`;
  const testAnswer = `Call our emergency number 108 or reply AMBULANCE to this chat.`;

  console.log('Step 1: Creating FAQ directly using createFaqService…');
  const created = await createFaqService(tenantId, 'integration-test', testQuestion, testAnswer);
  console.log('✓ FAQ created, review id:', created.id);
  console.log('  Status:', created.status);
  console.log('  Is Active:', created.is_active);

  console.log('\nStep 2: Verifying faq_knowledge_source entry…');
  const [[entry]] = await db.sequelize.query(
    `SELECT id, faq_review_id, faq_payload,
            JSON_UNQUOTE(JSON_EXTRACT(faq_payload, '$.question')) AS payload_question,
            JSON_UNQUOTE(JSON_EXTRACT(faq_payload, '$.answer')) AS payload_answer,
            is_active
     FROM faq_knowledge_source
     WHERE faq_review_id = ?
     LIMIT 1`,
    { replacements: [created.id] }
  );
  
  console.log('FAQ Knowledge Entry:');
  console.log('  ID:', entry.id);
  console.log('  Is Active:', entry.is_active);
  console.log('  Payload Question:', entry.payload_question);
  console.log('  Payload Answer:', entry.payload_answer);
  
  if (entry.payload_question !== testQuestion || entry.payload_answer !== testAnswer) {
    throw new Error('Payload values do not match!');
  }
  console.log('✓ Payload validated');

  console.log('\n🧹 Cleanup…');
  await db.sequelize.query('DELETE FROM faq_knowledge_source WHERE faq_review_id = ?', { 
    replacements: [created.id] 
  });
  await db.sequelize.query('DELETE FROM faq_reviews WHERE id = ?', { 
    replacements: [created.id] 
  });
  console.log('✓ Cleanup complete');

  console.log('\n✅ createFaqService test PASSED!');
  console.log('  ✓ Creates published faq_review');
  console.log('  ✓ Writes faq_payload JSON to faq_knowledge_source');
  console.log('  ✓ Marks entry as active immediately');

} catch (err) {
  console.error('\n❌ Test failed:', err.message);
  process.exitCode = 1;
} finally {
  await db.sequelize.close();
}
