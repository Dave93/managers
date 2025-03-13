'use client';

import React from 'react';
import { SortableContext, type SortableContextProps } from '@dnd-kit/sortable';

// This component is only used on the client side
export default function SortableContextClient(props: SortableContextProps) {
    return <SortableContext {...props} />;
} 