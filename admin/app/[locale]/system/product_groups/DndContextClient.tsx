'use client';

import React from 'react';
import { DndContext, type DndContextProps } from '@dnd-kit/core';

// This component is only used on the client side
export default function DndContextClient(props: DndContextProps) {
    return <DndContext {...props} />;
} 