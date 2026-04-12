# Edge types

| Category | Type | Use when |
|---|---|---|
| Structural | `analogous_to` | Same shape, different domains |
| Structural | `same_mechanism_as` | Same underlying mechanism (Gentner structure mapping) |
| Structural | `instance_of` | Concrete example of an abstract concept |
| Structural | `generalizes` | Abstract generalization of a concrete example |
| Causal | `causes` | A produces B |
| Causal | `depends_on` | A requires B (causal or cognitive prerequisite) |
| Epistemic | `contradicts` | Tension: both cannot be true |
| Epistemic | `evidence_for` | Empirical support |
| Epistemic | `refines` | More precise version (correction, not contradiction) |

## analogous_to vs same_mechanism_as

`analogous_to` = same shape. `same_mechanism_as` = same underlying mechanism. Use the stronger one when you can justify the why at mechanism level. Example: "Red Queen" and "tech debt spiral" are `analogous_to` (both feel like running to stand still) but probably not `same_mechanism_as` (the mechanisms differ — coevolution vs compounding interest).

## instance_of vs analogous_to

`instance_of`: "Bitcoin is an instance_of cryptographic commitment scheme." The specific IS a case of the abstract.
`analogous_to`: "Bitcoin mining is analogous_to an arms race." Same shape, different concepts.

## causes vs depends_on

`causes`: temporal/mechanistic. A produces B.
`depends_on`: prerequisite. B can't exist/function without A. Includes cognitive dependencies (you can't understand B without first understanding A).

## contradicts vs refines

`contradicts`: both can't be true; something must give.
`refines`: newer note is a more precise version of the older one — the older one was a coarser approximation, not wrong.
