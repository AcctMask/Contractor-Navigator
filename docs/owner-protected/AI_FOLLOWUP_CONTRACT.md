# OWNER-PROTECTED CONTRACT — NAVIGATOR AI FOLLOW-UP

Authority: Steve Pashoian, Owner

Status: OWNER PROTECTED

This contract defines protected Navigator / Actual Assistant AI Follow-Up
behavior.

No developer, AI agent, automated coding process, refactor, migration,
integration, application, deployment process, or other change authority
may intentionally alter these invariants without Steve Pashoian's explicit
approval.

## Protected invariants

1. Entering a configured AI Follow-Up stage establishes that stage's
   active workflow.

2. A newly established stage workflow begins with Message 1.

3. Progression through that workflow follows the timing configured in
   Developer Settings.

4. A job with an active_followup_workflow must remain eligible for
   centralized AI Follow-Up candidate selection regardless of whether
   crm_flow_key is NULL or contains historical/specialized intake identity.

5. An EMS-originated job may later participate in an ordinary active
   AI Follow-Up workflow.

6. EMS specialized-flow exclusion applies only when no ordinary active
   follow-up workflow has superseded that specialized execution context.

7. Paused jobs remain paused until intentionally unpaused.

8. Moving a job into a new configured AI Follow-Up stage establishes the
   new stage workflow and starts that workflow at Message 1 regardless of
   follow-up history from a prior stage.

9. Historical intake identity must not silently override a currently
   established ordinary active_followup_workflow.

10. Changes affecting these invariants require explicit Owner approval
    before implementation or deployment.

## Change-control rule

A proposed improvement may modify surrounding implementation details,
but it may not change the protected behavior above without explicit Owner
approval.

Passing compilation is not sufficient.

Passing unrelated tests is not sufficient.

A refactor is not sufficient justification.

An AI-generated change is not sufficient justification.

The Owner-Protected AI Follow-Up verification must pass before a change
is considered compatible with this contract.

## Protected baseline

Production candidate-selection repair:

8b78ce705691202b20c41ceb0de3c904c6e8249b

Regression-protection baseline:

e04591da6bd07da33a85ce8f47c31c7922365776

Hard Save tags:

navi-2.6-hard-save-ai-followup-candidate-repair-20261005

navi-2.6-hard-save-ai-followup-regression-protection-20261005
